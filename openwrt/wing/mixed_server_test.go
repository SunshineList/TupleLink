// SPDX-License-Identifier: AGPL-3.0-only
package control

import (
	"bufio"
	"context"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func mixedFixture(t *testing.T, dial MixedDial) net.Conn {
	t.Helper()
	client, server := net.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	go func() { defer server.Close(); serveMixedConn(ctx, server, dial) }()
	client.SetDeadline(time.Now().Add(3 * time.Second))
	t.Cleanup(func() { cancel(); client.Close() })
	return client
}

func mixedEchoDial(t *testing.T, want string) MixedDial {
	return func(_ context.Context, target, source string) (MixedConn, error) {
		if target != want {
			t.Errorf("target=%q, want %q", target, want)
		}
		a, b := net.Pipe()
		go func() { defer b.Close(); io.Copy(b, b) }()
		return a, nil
	}
}
func TestRouterMixedCONNECTBufferedPayload(t *testing.T) {
	client := mixedFixture(t, mixedEchoDial(t, "example.com:443"))
	go io.WriteString(client, "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\nhello")
	r := bufio.NewReader(client)
	res, err := http.ReadResponse(r, &http.Request{Method: "CONNECT"})
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("response=%v, error=%v", res, err)
	}
	data := make([]byte, 5)
	if _, err = io.ReadFull(r, data); err != nil || string(data) != "hello" {
		t.Fatalf("data=%s error=%v", data, err)
	}
}
func TestRouterMixedHTTPPostBodyAndCredentials(t *testing.T) {
	for _, chunked := range []bool{false, true} {
		t.Run(strconv.FormatBool(chunked), func(t *testing.T) { mixedHTTPPostBody(t, chunked) })
	}
}
func mixedHTTPPostBody(t *testing.T, chunked bool) {
	done := make(chan error, 1)
	client := mixedFixture(t, func(_ context.Context, target, source string) (MixedConn, error) {
		if target != "example.com:80" {
			t.Errorf("target=%s", target)
		}
		a, b := net.Pipe()
		go func() {
			defer b.Close()
			req, err := http.ReadRequest(bufio.NewReader(b))
			if err != nil {
				done <- err
				return
			}
			body, err := io.ReadAll(req.Body)
			if string(body) != "hello" || req.URL.String() != "/path?q=1" || req.Header.Get("Proxy-Authorization") != "" {
				t.Errorf("unexpected request: %v body=%s", req, body)
			}
			io.WriteString(b, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK")
			done <- err
		}()
		return a, nil
	})
	framing := "Content-Length: 5\r\n\r\nhello"
	if chunked {
		framing = "Transfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n"
	}
	go io.WriteString(client, "POST http://example.com/path?q=1 HTTP/1.1\r\nHost: example.com\r\nProxy-Authorization: secret\r\n"+framing)
	response, err := http.ReadResponse(bufio.NewReader(client), nil)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	if err != nil || string(body) != "OK" {
		t.Fatalf("body=%s err=%v", body, err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
func TestRouterMixedSOCKSAddressTypes(t *testing.T) {
	for _, host := range []string{"example.com", "192.0.2.1", "2001:db8::1"} {
		t.Run(host, func(t *testing.T) {
			client := mixedFixture(t, mixedEchoDial(t, net.JoinHostPort(host, "443")))
			client.Write([]byte{5, 1, 0})
			var greeting [2]byte
			if _, err := io.ReadFull(client, greeting[:]); err != nil || greeting != [2]byte{5, 0} {
				t.Fatal(greeting, err)
			}
			request := []byte{5, 1, 0}
			if ip := net.ParseIP(host); ip != nil {
				if v4 := ip.To4(); v4 != nil {
					request = append(request, 1)
					request = append(request, v4...)
				} else {
					request = append(request, 4)
					request = append(request, ip.To16()...)
				}
			} else {
				request = append(request, 3, byte(len(host)))
				request = append(request, host...)
			}
			request = binary.BigEndian.AppendUint16(request, 443)
			go client.Write(append(request, []byte("hello")...))
			reply := make([]byte, 15)
			if _, err := io.ReadFull(client, reply); err != nil || reply[1] != 0 || string(reply[10:]) != "hello" {
				t.Fatalf("reply=%v err=%v", reply, err)
			}
		})
	}
}
func TestRouterMixedRejectsUDP(t *testing.T) {
	client := mixedFixture(t, func(context.Context, string, string) (MixedConn, error) { t.Error("must not dial"); return nil, nil })
	client.Write([]byte{5, 1, 0})
	io.ReadFull(client, make([]byte, 2))
	client.Write([]byte{5, 3, 0, 1})
	reply := make([]byte, 10)
	if _, err := io.ReadFull(client, reply); err != nil || reply[1] != 7 {
		t.Fatal(reply, err)
	}
}
func TestRouterMixedRejectsOversizedHeader(t *testing.T) {
	client := mixedFixture(t, func(context.Context, string, string) (MixedConn, error) { t.Error("must not dial"); return nil, nil })
	go io.WriteString(client, "GET http://example.com/ HTTP/1.1\r\nX: "+strings.Repeat("x", 40000)+"\r\n\r\n")
	if _, err := client.Read(make([]byte, 1)); err == nil {
		t.Fatal("expected closed connection")
	}
}
