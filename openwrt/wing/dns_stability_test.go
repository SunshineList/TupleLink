// SPDX-License-Identifier: AGPL-3.0-only
package control

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"

	"github.com/daeuniverse/dae/common/netutils"
	"github.com/daeuniverse/dae/component/dns"
	"github.com/daeuniverse/outbound/netproxy"
	dnsmessage "github.com/miekg/dns"
	"github.com/olicesx/quic-go"
	"github.com/sirupsen/logrus"
	logtest "github.com/sirupsen/logrus/hooks/test"
)

func TestRouterDNSBootstrapBackupBudget(t *testing.T) {
	cp := newTestControlPlaneForRealDomainProbe()
	defer cp.cancel()
	first, second := netip.MustParseAddrPort("127.0.0.1:2053"), netip.MustParseAddrPort("127.0.0.1:2054")
	cp.bootstrapResolvers = []netip.AddrPort{first, second}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	var calls int
	result, _, _ := cp.resolveIp46WithBootstrapResolvers(ctx, "backup.example", "udp", false, func(c context.Context, _ netproxy.Dialer, resolver netip.AddrPort, _, _ string, _ bool) (*netutils.Ip46, error, error) {
		calls++
		if resolver == first {
			<-c.Done()
			return &netutils.Ip46{}, c.Err(), c.Err()
		}
		if c.Err() != nil {
			return &netutils.Ip46{}, c.Err(), c.Err()
		}
		return &netutils.Ip46{Ip4: netip.MustParseAddr("192.0.2.5")}, nil, nil
	})
	if !result.Ip4.IsValid() || calls != 2 {
		t.Fatalf("backup got no usable budget: result=%v calls=%d", result, calls)
	}
}

func TestRouterDNSPipelineQueuedCancelLeavesWriterAlone(t *testing.T) {
	client, peer := net.Pipe()
	defer peer.Close()
	pc := newPipelinedConn(client)
	defer pc.Close()
	pc.routerWrite <- struct{}{}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := pc.RoundTrip(ctx, routerDNSQuery(t)); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	<-pc.routerWrite
	select {
	case <-pc.closed:
		t.Fatal("queued query cancellation closed shared connection")
	default:
	}
	go func() {
		b, e := routerDNSFrameRead(peer)
		if e == nil {
			_ = routerDNSFrameWrite(peer, b)
		}
	}()
	ctx2, cancel2 := context.WithTimeout(context.Background(), time.Second)
	defer cancel2()
	if _, e := pc.RoundTrip(ctx2, routerDNSQuery(t)); e != nil {
		t.Fatal(e)
	}
}

func TestRouterDNSPipelinePartialWriteClosesCorruptStream(t *testing.T) {
	client, peer := net.Pipe()
	defer peer.Close()
	pc := newPipelinedConn(client)
	defer pc.Close()
	go func() { var b [1]byte; _, _ = peer.Read(b[:]) }()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, e := pc.RoundTrip(ctx, routerDNSQuery(t)); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
	select {
	case <-pc.closed:
	default:
		t.Fatal("partial DNS frame was left reusable")
	}
}

func TestRouterDNSQUICSocketOwnershipOnTermination(t *testing.T) {
	for _, remote := range []bool{false, true} {
		t.Run(fmt.Sprint(remote), func(t *testing.T) {
			raw, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
			if e != nil {
				t.Fatal(e)
			}
			defer raw.Close()
			tracked := &routerOwnedUDP{UDPConn: raw}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			fake := newFakeEarlyConnection()
			fake.ctx = ctx
			owned := &routerOwnedQUICConn{EarlyConnection: fake, raw: tracked}
			finished := make(chan struct{})
			context.AfterFunc(ctx, func() { owned.release(); close(finished) })
			if !remote {
				_ = owned.CloseWithError(0, "")
			}
			cancel()
			<-finished
			_ = owned.CloseWithError(0, "")
			if tracked.closes.Load() != 1 {
				t.Fatalf("UDP ownership cleanup count=%d", tracked.closes.Load())
			}
		})
	}
}

func TestRouterDNSDiagnosticDoesNotExposeCredentials(t *testing.T) {
	log := logrus.New()
	var output bytes.Buffer
	log.SetOutput(&output)
	hook := logtest.NewLocal(log)
	secret := errors.New("anytls://fixture-secret@invalid.example")
	routerLogAttempt(log, "proxy_connect", 1, time.Now(), secret, nil)
	if len(hook.AllEntries()) != 0 {
		t.Fatal("normal log level enabled verbose diagnostics")
	}
	log.SetLevel(logrus.DebugLevel)
	routerLogAttempt(log, "proxy_connect", 2, time.Now().Add(-50*time.Millisecond), secret, nil)
	entry := hook.LastEntry()
	if entry == nil || entry.Data["phase"] != "proxy_connect" || entry.Data["result"] != "failed" || entry.Data["attempt"] != 2 || entry.Data["elapsed_ms"].(int64) < 50 {
		t.Fatal("diagnostic fields missing")
	}
	if bytes.Contains(output.Bytes(), []byte("fixture-secret")) || bytes.Contains(output.Bytes(), []byte("invalid.example")) {
		t.Fatal("diagnostic leaked raw connection error")
	}
}

func TestRouterDNSBootstrapCancelAndSingleResolver(t *testing.T) {
	cp := newTestControlPlaneForRealDomainProbe()
	defer cp.cancel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	_, e4, _ := cp.resolveIp46WithBootstrapResolvers(ctx, "cancel.example", "udp", false, func(context.Context, netproxy.Dialer, netip.AddrPort, string, string, bool) (*netutils.Ip46, error, error) {
		called = true
		return nil, nil, nil
	})
	if called || !errors.Is(e4, context.Canceled) {
		t.Fatal("bootstrap ignored parent cancellation")
	}
	ctx, cancel = context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	deadline, _ := ctx.Deadline()
	_, _, _ = cp.resolveIp46WithBootstrapResolvers(ctx, "single.example", "udp", false, func(c context.Context, _ netproxy.Dialer, _ netip.AddrPort, _, _ string, _ bool) (*netutils.Ip46, error, error) {
		got, _ := c.Deadline()
		if got != deadline {
			t.Fatal("explicit single resolver deadline was shortened")
		}
		return &netutils.Ip46{}, nil, nil
	})
}

type routerOwnedUDP struct {
	*net.UDPConn
	closes atomic.Int32
}

func (c *routerOwnedUDP) Close() error { c.closes.Add(1); return c.UDPConn.Close() }
func (c *routerOwnedUDP) ReadFrom(p []byte) (int, netip.AddrPort, error) {
	return c.UDPConn.ReadFromUDPAddrPort(p)
}
func (c *routerOwnedUDP) WriteTo(p []byte, address string) (int, error) {
	a, e := netip.ParseAddrPort(address)
	if e != nil {
		return 0, e
	}
	return c.UDPConn.WriteToUDPAddrPort(p, a)
}

func TestRouterDNSH3FailedDialClosesUDP(t *testing.T) {
	silent, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if e != nil {
		t.Fatal(e)
	}
	defer silent.Close()
	raw, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if e != nil {
		t.Fatal(e)
	}
	defer raw.Close()
	tracked := &routerOwnedUDP{UDPConn: raw}
	d := &DoH{Upstream: dns.Upstream{Hostname: "localhost"}, dialArgument: dialArgument{bestDialer: routerDNSDialer(t, func(context.Context, string, string) (netproxy.Conn, error) { return tracked, nil }), bestTarget: silent.LocalAddr().(*net.UDPAddr).AddrPort()}}
	tr := d.getHttp3RoundTripper()
	defer tr.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	_, e = tr.Dial(ctx, silent.LocalAddr().String(), &tls.Config{ServerName: "localhost", NextProtos: []string{"h3"}}, &quic.Config{})
	if e == nil || tracked.closes.Load() != 1 {
		t.Fatalf("failed QUIC retained its UDP connection: error=%v closes=%d", e, tracked.closes.Load())
	}
}

func routerDNSFrameRead(conn net.Conn) ([]byte, error) {
	var h [2]byte
	if _, e := io.ReadFull(conn, h[:]); e != nil {
		return nil, e
	}
	b := make([]byte, binary.BigEndian.Uint16(h[:]))
	_, e := io.ReadFull(conn, b)
	return b, e
}
func routerDNSFrameWrite(conn net.Conn, b []byte) error {
	var h [2]byte
	binary.BigEndian.PutUint16(h[:], uint16(len(b)))
	_, e := conn.Write(append(h[:], b...))
	return e
}

func TestRouterDNSPipelineCancelDoesNotCloseSibling(t *testing.T) {
	client, peer := net.Pipe()
	defer peer.Close()
	pc := newPipelinedConn(client)
	defer pc.Close()
	ctxA, cancelA := context.WithCancel(context.Background())
	defer cancelA()
	ctxB, cancelB := context.WithTimeout(context.Background(), time.Second)
	defer cancelB()
	oneRead, bothRead, reply := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		_, e := routerDNSFrameRead(peer)
		close(oneRead)
		if e != nil {
			return
		}
		b, e := routerDNSFrameRead(peer)
		close(bothRead)
		if e != nil {
			return
		}
		<-reply
		_ = routerDNSFrameWrite(peer, b)
	}()
	aDone, bDone := make(chan error, 1), make(chan error, 1)
	go func() { _, e := pc.RoundTrip(ctxA, routerDNSQuery(t)); aDone <- e }()
	<-oneRead
	go func() { _, e := pc.RoundTrip(ctxB, routerDNSQuery(t)); bDone <- e }()
	<-bothRead
	cancelA()
	if e := <-aDone; !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	close(reply)
	if e := <-bDone; e != nil {
		t.Fatalf("healthy sibling failed: %v", e)
	}
	if pc.pendingCount.Load() != 0 {
		t.Fatal("pending count leaked")
	}
}

func TestRouterDNSPipelineLateAnswerCannotReachNextQuery(t *testing.T) {
	client, peer := net.Pipe()
	defer peer.Close()
	pc := newPipelinedConn(client)
	defer pc.Close()
	ctxA, cancelA := context.WithCancel(context.Background())
	defer cancelA()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	frames := make(chan []byte, 3)
	go func() {
		for range 3 {
			b, e := routerDNSFrameRead(peer)
			if e != nil {
				return
			}
			frames <- b
		}
	}()
	aDone := make(chan error, 1)
	go func() { _, e := pc.RoundTrip(ctxA, routerDNSQuery(t)); aDone <- e }()
	a := <-frames
	bDone := make(chan error, 1)
	go func() { _, e := pc.RoundTrip(ctx, routerDNSQuery(t)); bDone <- e }()
	b := <-frames
	cancelA()
	<-aDone
	cDone := make(chan error, 1)
	go func() { _, e := pc.RoundTrip(ctx, routerDNSQuery(t)); cDone <- e }()
	c := <-frames
	if binary.BigEndian.Uint16(a) == binary.BigEndian.Uint16(c) {
		t.Fatal("canceled ID was reused before late response")
	}
	if e := routerDNSFrameWrite(peer, a); e != nil {
		t.Fatal(e)
	}
	select {
	case e := <-cDone:
		t.Fatalf("late A answered C: %v", e)
	default:
	}
	if e := routerDNSFrameWrite(peer, c); e != nil {
		t.Fatal(e)
	}
	if e := <-cDone; e != nil {
		t.Fatal(e)
	}
	if e := routerDNSFrameWrite(peer, b); e != nil {
		t.Fatal(e)
	}
	if e := <-bDone; e != nil {
		t.Fatal(e)
	}
}

func TestRouterDNSDoQRealStreamCancelIsolated(t *testing.T)   { routerDNSDoQRealStream(t, false) }
func TestRouterDNSDoQRealStreamDeadlineIsolated(t *testing.T) { routerDNSDoQRealStream(t, true) }

func routerDNSDoQRealStream(t *testing.T, deadline bool) {
	t.Helper()
	certServer := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	certs := certServer.TLS.Certificates
	certServer.Close()
	server, e := quic.ListenAddr("127.0.0.1:0", &tls.Config{Certificates: certs, NextProtos: []string{"doq"}}, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer server.Close()
	setup, cancelSetup := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancelSetup()
	firstRead := make(chan struct{})
	go func() {
		conn, e := server.Accept(setup)
		if e != nil {
			return
		}
		for i := 0; i < 2; i++ {
			s, e := conn.AcceptStream(setup)
			if e != nil {
				return
			}
			go func(index int, s quic.Stream) {
				b, e := io.ReadAll(s)
				if e != nil {
					return
				}
				if index == 0 {
					close(firstRead)
					return
				}
				m := new(dnsmessage.Msg)
				if m.Unpack(b[2:]) != nil {
					return
				}
				resp := new(dnsmessage.Msg)
				resp.SetReply(m)
				packed, _ := resp.Pack()
				var h [2]byte
				binary.BigEndian.PutUint16(h[:], uint16(len(packed)))
				s.Write(append(h[:], packed...))
				s.Close()
			}(i, s)
		}
	}()
	client, e := quic.DialAddrEarly(setup, server.Addr().String(), &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"doq"}}, nil)
	if e != nil {
		t.Fatal(e)
	}
	defer client.CloseWithError(0, "")
	select {
	case <-client.HandshakeComplete():
	case <-setup.Done():
		t.Fatal(setup.Err())
	}
	d := &DoQ{connection: client}
	defer d.Close()
	ctx, cancel := context.WithCancel(context.Background())
	if deadline {
		cancel()
		ctx, cancel = context.WithTimeout(context.Background(), 100*time.Millisecond)
	}
	defer cancel()
	result := make(chan error, 1)
	go func() { _, e := d.ForwardDNS(ctx, routerDNSQuery(t)); result <- e }()
	select {
	case <-firstRead:
	case <-setup.Done():
		t.Fatal("server did not receive query FIN")
	}
	start := time.Now()
	if !deadline {
		cancel()
	}
	select {
	case e := <-result:
		want := context.Canceled
		if deadline {
			want = context.DeadlineExceeded
		}
		if !errors.Is(e, want) {
			t.Fatal(e)
		}
	case <-time.After(time.Second):
		t.Fatal("DoQ cancel did not interrupt stream")
	}
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("slow stream cancellation")
	}
	if _, e := d.ForwardDNS(setup, routerDNSQuery(t)); e != nil {
		t.Fatalf("cancel killed shared QUIC connection: %v", e)
	}
}

func TestRouterDNSBootstrapRealUDPBackup(t *testing.T) {
	silent, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if e != nil {
		t.Fatal(e)
	}
	defer silent.Close()
	answer, e := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if e != nil {
		t.Fatal(e)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		b := make([]byte, 4096)
		for {
			n, addr, e := answer.ReadFromUDPAddrPort(b)
			if e != nil {
				return
			}
			q := new(dnsmessage.Msg)
			if q.Unpack(b[:n]) != nil {
				continue
			}
			m := new(dnsmessage.Msg)
			m.SetReply(q)
			if len(q.Question) > 0 && q.Question[0].Qtype == dnsmessage.TypeA {
				m.Answer = []dnsmessage.RR{&dnsmessage.A{Hdr: dnsmessage.RR_Header{Name: q.Question[0].Name, Rrtype: dnsmessage.TypeA, Class: dnsmessage.ClassINET, Ttl: 60}, A: net.IPv4(192, 0, 2, 9)}}
			}
			packed, _ := m.Pack()
			_, _ = answer.WriteToUDPAddrPort(packed, addr)
		}
	}()
	defer func() { answer.Close(); <-done }()
	cp := newTestControlPlaneForRealDomainProbe()
	defer cp.cancel()
	cp.bootstrapResolvers = []netip.AddrPort{silent.LocalAddr().(*net.UDPAddr).AddrPort(), answer.LocalAddr().(*net.UDPAddr).AddrPort()}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, e4, e6 := cp.resolveIp46WithBootstrapResolvers(ctx, "real-backup.example", "udp", false, netutils.ResolveIp46)
	if result.Ip4 != netip.MustParseAddr("192.0.2.9") {
		t.Fatalf("working UDP backup could not resolve: %v, %v, %v", result, e4, e6)
	}
}

func TestRouterDNSFailureWarningIncludesTiming(t *testing.T) {
	ctrl := newTestDnsController()
	defer ctrl.Close()
	ctrl.log = logrus.New()
	ctrl.log.SetOutput(io.Discard)
	hook := logtest.NewLocal(ctrl.log)
	upstream := &dns.Upstream{Scheme: dns.UpstreamScheme_TCP, Hostname: "dns.example", Port: 53}
	arg := &dialArgument{}
	entry := newCachedDnsForwarder(&stubDnsForwarder{forward: func(context.Context, []byte) (*dnsmessage.Msg, error) { return nil, io.EOF }}, time.Now())
	ctrl.dnsForwarderCache.Store(newDnsForwarderKey(upstream, arg), entry)
	_, _ = ctrl.forwardWithDialArg(context.Background(), upstream, arg, routerDNSQuery(t))
	log := hook.LastEntry()
	if log == nil || log.Data["phase"] != "dns_forward" || log.Data["result"] != "closed" {
		t.Fatalf("missing failure diagnostic: %v", log)
	}
	if _, ok := log.Data["elapsed_ms"].(int64); !ok {
		t.Fatal("missing failure duration")
	}
}
