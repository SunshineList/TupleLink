// SPDX-License-Identifier: AGPL-3.0-only
package control

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MixedConn deliberately matches both net.Conn and the core's netproxy.Conn.
type MixedConn interface {
	io.ReadWriteCloser
	SetDeadline(time.Time) error
}
type MixedDial func(context.Context, string, string) (MixedConn, error)

// ServeMixed accepts HTTP forward requests, HTTPS CONNECT and SOCKS5 CONNECT.
// Admission is restricted to local/private clients, even when bound on LAN.
// The caller owns the listener and cancels ctx during service shutdown.
func ServeMixed(ctx context.Context, listener net.Listener, dial MixedDial) error {
	slots := make(chan struct{}, 128)
	go func() { <-ctx.Done(); listener.Close() }()
	for {
		conn, err := listener.Accept()
		if err != nil {
			return err
		}
		host, _, _ := net.SplitHostPort(conn.RemoteAddr().String())
		ip := net.ParseIP(host)
		if ip == nil || !(ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()) {
			conn.Close()
			continue
		}
		select {
		case slots <- struct{}{}:
			go func() { defer func() { <-slots; conn.Close() }(); serveMixedConn(ctx, conn, dial) }()
		default:
			conn.Close()
		}
	}
}

func serveMixedConn(ctx context.Context, conn net.Conn, dial MixedDial) {
	conn.SetDeadline(time.Now().Add(15 * time.Second))
	reader := bufio.NewReaderSize(conn, 32*1024)
	first, err := reader.Peek(1)
	if err != nil {
		return
	}
	var remote MixedConn
	if first[0] == 5 {
		remote, err = mixedSOCKS(ctx, conn, reader, dial)
	} else {
		remote, err = mixedHTTP(ctx, conn, reader, dial)
	}
	if err != nil || remote == nil {
		return
	}
	defer func() { remote.SetDeadline(time.Now()); remote.Close() }()
	conn.SetDeadline(time.Time{})
	remote.SetDeadline(time.Time{})
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			conn.Close()
			remote.SetDeadline(time.Now())
			remote.Close()
		case <-done:
		}
	}()
	defer close(done)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		io.Copy(remote, reader)
		if half, ok := remote.(interface{ CloseWrite() error }); ok {
			half.CloseWrite()
		} else {
			// Some encrypted upstreams cannot half-close. Give the response
			// time to drain instead of cutting it off on client write EOF.
			remote.SetDeadline(time.Now().Add(30 * time.Second))
		}
	}()
	io.Copy(conn, remote)
	conn.SetDeadline(time.Now())
	remote.SetDeadline(time.Now())
	wg.Wait()
}

func mixedSOCKS(ctx context.Context, conn net.Conn, r *bufio.Reader, dial MixedDial) (MixedConn, error) {
	var head [2]byte
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return nil, err
	}
	methods := make([]byte, int(head[1]))
	if _, err := io.ReadFull(r, methods); err != nil {
		return nil, err
	}
	noAuth := false
	for _, method := range methods {
		if method == 0 {
			noAuth = true
		}
	}
	if !noAuth {
		conn.Write([]byte{5, 255})
		return nil, errors.New("authentication method unsupported")
	}
	if _, err := conn.Write([]byte{5, 0}); err != nil {
		return nil, err
	}
	var request [4]byte
	if _, err := io.ReadFull(r, request[:]); err != nil {
		return nil, err
	}
	if request[0] != 5 || request[2] != 0 {
		return nil, errors.New("invalid SOCKS request")
	}
	fail := func(code byte) (MixedConn, error) {
		conn.Write([]byte{5, code, 0, 1, 0, 0, 0, 0, 0, 0})
		return nil, errors.New("SOCKS request rejected")
	}
	if request[1] != 1 {
		return fail(7)
	}
	var host string
	switch request[3] {
	case 1, 4:
		size := 4
		if request[3] == 4 {
			size = 16
		}
		ip := make([]byte, size)
		if _, err := io.ReadFull(r, ip); err != nil {
			return nil, err
		}
		host = net.IP(ip).String()
	case 3:
		size, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		name := make([]byte, int(size))
		if _, err = io.ReadFull(r, name); err != nil {
			return nil, err
		}
		host = string(name)
	default:
		return fail(8)
	}
	var port [2]byte
	if _, err := io.ReadFull(r, port[:]); err != nil {
		return nil, err
	}
	if host == "" || binary.BigEndian.Uint16(port[:]) == 0 {
		return fail(1)
	}
	remote, err := dial(ctx, net.JoinHostPort(host, strconv.Itoa(int(binary.BigEndian.Uint16(port[:])))), conn.RemoteAddr().String())
	if err != nil {
		return fail(5)
	}
	if _, err = conn.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
		remote.Close()
		return nil, err
	}
	return remote, nil
}

func mixedHTTP(ctx context.Context, conn net.Conn, r *bufio.Reader, dial MixedDial) (MixedConn, error) {
	// Bound the request headers before invoking net/http's parser.
	var header strings.Builder
	for {
		part, err := r.ReadSlice('\n')
		if err != nil {
			return nil, err
		}
		line := string(part)
		if header.Len()+len(line) > 32768 {
			return nil, errors.New("headers too large")
		}
		header.WriteString(line)
		if line == "\r\n" || line == "\n" {
			break
		}
	}
	req, err := http.ReadRequest(bufio.NewReader(strings.NewReader(header.String())))
	if err != nil {
		return nil, err
	}
	target := req.Host
	if req.Method != http.MethodConnect {
		if req.URL.Scheme != "http" || req.URL.Host == "" {
			io.WriteString(conn, "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
			return nil, errors.New("absolute HTTP URL required")
		}
		target = req.URL.Host
		if req.URL.Port() == "" {
			target = net.JoinHostPort(req.URL.Hostname(), "80")
		}
	}
	if _, port, err := net.SplitHostPort(target); err != nil || port == "" {
		return nil, errors.New("invalid target")
	}
	remote, err := dial(ctx, target, conn.RemoteAddr().String())
	if err != nil {
		io.WriteString(conn, "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
		return nil, err
	}
	if req.Method == http.MethodConnect {
		_, err = io.WriteString(conn, "HTTP/1.1 200 Connection Established\r\n\r\n")
	} else {
		// One request per upstream connection prevents subsequent absolute proxy
		// requests from bypassing routing. Bodies (including chunking) relay intact.
		req.Header.Del("Proxy-Authorization")
		req.Header.Del("Proxy-Connection")
		req.Header.Set("Connection", "close")
		if len(req.TransferEncoding) > 0 {
			req.Header.Set("Transfer-Encoding", strings.Join(req.TransferEncoding, ", "))
		}
		uri := req.URL.RequestURI()
		_, err = io.WriteString(remote, req.Method+" "+uri+" "+req.Proto+"\r\nHost: "+req.URL.Host+"\r\n")
		if err == nil {
			err = req.Header.Write(remote)
		}
		if err == nil {
			_, err = io.WriteString(remote, "\r\n")
		}
	}
	if err != nil {
		remote.Close()
		return nil, err
	}
	return remote, nil
}
