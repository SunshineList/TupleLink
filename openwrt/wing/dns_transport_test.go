// SPDX-License-Identifier: AGPL-3.0-only
package control

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/daeuniverse/dae/component/dns"
	"github.com/daeuniverse/dae/component/outbound/dialer"
	"github.com/daeuniverse/outbound/netproxy"
	dnsmessage "github.com/miekg/dns"
	"github.com/sirupsen/logrus"
)

type routerDNSRoundTripFunc func(*http.Request) (*http.Response, error)

func (f routerDNSRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func routerDNSQuery(t *testing.T) []byte {
	t.Helper()
	m := new(dnsmessage.Msg)
	m.SetQuestion("first-open.example.", dnsmessage.TypeA)
	b, err := m.Pack()
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func routerDNSDialer(t *testing.T, fn routerTestDialFunc) *dialer.Dialer {
	t.Helper()
	log := logrus.New()
	log.SetOutput(io.Discard)
	d := dialer.NewDialer(fn, &dialer.GlobalOption{Log: log, CheckInterval: time.Second}, dialer.InstanceOption{DisableCheck: true}, &dialer.Property{})
	t.Cleanup(func() { d.Close() })
	return d
}

func TestRouterDNSDoHRequestDeadline(t *testing.T) {
	var calls atomic.Int32
	d := &DoH{Upstream: dns.Upstream{Hostname: "dns.example", Path: "/dns-query"}, dialArgument: dialArgument{bestTarget: netip.MustParseAddrPort("127.0.0.1:443")}}
	d.clientFactory = func() *http.Client {
		return &http.Client{Transport: routerDNSRoundTripFunc(func(r *http.Request) (*http.Response, error) {
			calls.Add(1)
			select {
			case <-r.Context().Done():
				return nil, r.Context().Err()
			case <-time.After(250 * time.Millisecond):
				return nil, io.ErrUnexpectedEOF
			}
		})}
	}
	defer d.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := d.ForwardDNS(ctx, routerDNSQuery(t))
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 180*time.Millisecond || calls.Load() != 1 {
		t.Fatalf("DoH ignored request deadline: %v, elapsed=%s, calls=%d", err, time.Since(start), calls.Load())
	}
}

func TestRouterDNSDoTLSHandshakeDeadline(t *testing.T) {
	client, peer := net.Pipe()
	defer client.Close()
	defer peer.Close()
	// The upstream accepts TCP but never reads/replies to the TLS handshake.
	cleanup := time.AfterFunc(300*time.Millisecond, func() { peer.Close() })
	defer cleanup.Stop()
	d := &DoTLS{Upstream: dns.Upstream{Hostname: "dns.example"}, dialArgument: dialArgument{bestDialer: routerDNSDialer(t, func(context.Context, string, string) (netproxy.Conn, error) { return client, nil })}}
	defer d.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := d.ForwardDNS(ctx, routerDNSQuery(t))
	if err == nil || time.Since(start) > 180*time.Millisecond {
		t.Fatalf("DoT handshake outlived request: %v, elapsed=%s", err, time.Since(start))
	}
}

func TestRouterDNSPipelineBlockedWrite(t *testing.T) {
	client, peer := net.Pipe()
	defer peer.Close()
	pc := newPipelinedConn(client)
	defer pc.Close()
	cleanup := time.AfterFunc(300*time.Millisecond, func() { peer.Close() })
	defer cleanup.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := pc.RoundTrip(ctx, routerDNSQuery(t))
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 180*time.Millisecond {
		t.Fatalf("blocked DNS write outlived request: %v, elapsed=%s", err, time.Since(start))
	}
}

func TestRouterDNSPoolLateDialAfterClose(t *testing.T) {
	client, peer := net.Pipe()
	defer client.Close()
	defer peer.Close()
	started, release := make(chan struct{}), make(chan struct{})
	p := newConnPool(1, func(context.Context) (netproxy.Conn, error) { close(started); <-release; return client, nil })
	result := make(chan error, 1)
	go func() {
		conn, err := p.get(context.Background())
		if conn != nil {
			conn.Close()
		}
		result <- err
	}()
	<-started
	p.close()
	close(release)
	if err := <-result; !errors.Is(err, net.ErrClosed) {
		t.Fatalf("closed pool accepted late dial: %v", err)
	}
	p.close()
}

func TestRouterDNSPoolColdStartCoalescesDials(t *testing.T) {
	var calls atomic.Int32
	var peers []net.Conn
	p := newConnPool(4, func(ctx context.Context) (netproxy.Conn, error) {
		calls.Add(1)
		time.Sleep(15 * time.Millisecond)
		client, peer := net.Pipe()
		peers = append(peers, peer)
		return client, nil
	})
	// Start simultaneous requests without sending payloads: one connection suffices.
	// The dialer serializes the peer slice for race-safe observation in this fixture.
	var guard sync.Mutex
	original := p.dialer
	p.dialer = func(ctx context.Context) (netproxy.Conn, error) {
		guard.Lock()
		defer guard.Unlock()
		return original(ctx)
	}
	defer func() {
		p.close()
		for _, peer := range peers {
			peer.Close()
		}
	}()
	done := make(chan error, 24)
	for range 24 {
		go func() { _, err := p.get(context.Background()); done <- err }()
	}
	for range 24 {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("cold DNS lookup created %d simultaneous/redundant connections", calls.Load())
	}
}

func TestRouterDNSCanceledDoesNotCountAsNodeFailure(t *testing.T) {
	upstream := &dns.Upstream{Scheme: dns.UpstreamScheme_TCP, Hostname: "dns.example", Port: 53}
	arg := &dialArgument{}
	entry := newCachedDnsForwarder(&stubDnsForwarder{forward: func(context.Context, []byte) (*dnsmessage.Msg, error) { return nil, context.Canceled }}, time.Now())
	ctrl := newTestDnsController()
	ctrl.dnsForwarderCache.Store(newDnsForwarderKey(upstream, arg), entry)
	_, err := ctrl.forwardWithDialArg(context.Background(), upstream, arg, routerDNSQuery(t))
	if !errors.Is(err, context.Canceled) || entry.consecutiveErrors.Load() != 0 {
		t.Fatalf("cancellation polluted node failure count: %v, count=%d", err, entry.consecutiveErrors.Load())
	}
}

func TestRouterDNSDoHRealTLSCancellation(t *testing.T) {
	started := make(chan struct{}, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { started <- struct{}{}; <-r.Context().Done() }))
	defer server.Close()
	d := &DoH{Upstream: dns.Upstream{Hostname: "example.com", Path: "/dns-query"}, dialArgument: dialArgument{bestTarget: server.Listener.Addr().(*net.TCPAddr).AddrPort()}}
	d.clientFactory = server.Client
	defer d.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := d.ForwardDNS(ctx, []byte{0, 1, 0, 0}); result <- err }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("DoH request never reached trusted TLS upstream")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("unexpected cancellation: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("real DoH upstream cancellation was ignored")
	}
}

func TestRouterDNSDoHDoesNotMutateSharedQuery(t *testing.T) {
	query := routerDNSQuery(t)
	original := append([]byte(nil), query...)
	client := &http.Client{Transport: routerDNSRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		m := new(dnsmessage.Msg)
		m.SetReply(&dnsmessage.Msg{MsgHdr: dnsmessage.MsgHdr{Id: 0}})
		b, _ := m.Pack()
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"application/dns-message"}}, Body: io.NopCloser(bytes.NewReader(b))}, nil
	})}
	d := &DoH{Upstream: dns.Upstream{Hostname: "dns.example"}, dialArgument: dialArgument{bestTarget: netip.MustParseAddrPort("127.0.0.1:443")}, client: client}
	defer d.Close()
	result := make(chan error, 16)
	for range 16 {
		go func() { _, err := d.ForwardDNS(context.Background(), query); result <- err }()
	}
	for range 16 {
		if err := <-result; err != nil {
			t.Fatal(err)
		}
	}
	if !bytes.Equal(query, original) {
		t.Fatal("DoH modified the caller's shared DNS message")
	}
}

func TestRouterDNSRepeatedCancelReleasesPipelineState(t *testing.T) {
	for range 40 {
		client, peer := net.Pipe()
		pc := newPipelinedConn(client)
		ctx, cancel := context.WithCancel(context.Background())
		result := make(chan error, 1)
		go func() { _, err := pc.RoundTrip(ctx, []byte{0, 1, 0, 0}); result <- err }()
		frame := make([]byte, 6)
		_ = peer.SetReadDeadline(time.Now().Add(time.Second))
		if _, err := io.ReadFull(peer, frame); err != nil {
			cancel()
			pc.Close()
			peer.Close()
			t.Fatal(err)
		}
		cancel()
		select {
		case <-result:
		case <-time.After(time.Second):
			peer.Close()
			t.Fatal("canceled pipeline retained a writer")
		}
		pc.Close()
		peer.Close()
		if pc.pendingCount.Load() != 0 {
			t.Fatal("pending request count leaked")
		}
		for i := range pc.pending {
			if pc.pending[i].Load() != nil {
				t.Fatal("response slot leaked")
			}
		}
		for i := range pc.idAlloc.bitmap {
			if pc.idAlloc.bitmap[i].Load() != 0 {
				t.Fatal("request ID leaked")
			}
		}
	}
}

func TestRouterDNSLazyPoolCloseDuringInitialization(t *testing.T) {
	var lazy lazyConnPool
	started, release := make(chan struct{}), make(chan struct{})
	result := make(chan *connPool, 1)
	go func() {
		result <- lazy.getOrInit(func() *connPool { close(started); <-release; return newConnPool(1, nil) })
	}()
	<-started
	lazy.closePool()
	close(release)
	if p := <-result; p != nil {
		t.Fatal("pool initialized after its forwarder was closed")
	}
	stored := lazy.pool.Load().(*connPool)
	stored.mu.RLock()
	closed := stored.closed
	stored.mu.RUnlock()
	if !closed {
		t.Fatal("late initialized pool retained state")
	}
}

func TestRouterDNSPoolWaitCancellationAndClose(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	client, peer := net.Pipe()
	defer peer.Close()
	var calls atomic.Int32
	p := newConnPool(1, func(context.Context) (netproxy.Conn, error) {
		calls.Add(1)
		close(started)
		<-release
		return client, nil
	})
	first := make(chan error, 1)
	go func() { _, err := p.get(context.Background()); first <- err }()
	<-started
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := p.get(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waiting dial ignored cancellation: %v", err)
	}
	p.close()
	close(release)
	if err := <-first; !errors.Is(err, net.ErrClosed) {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatal("canceled waiter started another connection")
	}
}

func TestRouterDNSUDPCancelInterruptsRead(t *testing.T) {
	client, peer := net.Pipe()
	defer client.Close()
	defer peer.Close()
	// A stream-shaped fake exercises the same context/deadline contract as UDP.
	go func() { b := make([]byte, 2048); _, _ = peer.Read(b) }()
	d := &DoUDP{dialArgument: dialArgument{bestDialer: routerDNSDialer(t, func(context.Context, string, string) (netproxy.Conn, error) { return client, nil }), bestTarget: netip.MustParseAddrPort("127.0.0.1:53")}}
	defer d.Close()
	ctx, cancel := context.WithCancel(context.Background())
	timer := time.AfterFunc(30*time.Millisecond, cancel)
	defer timer.Stop()
	defer cancel()
	cleanup := time.AfterFunc(300*time.Millisecond, func() { peer.Close() })
	defer cleanup.Stop()
	start := time.Now()
	_, err := d.ForwardDNS(ctx, routerDNSQuery(t))
	if err == nil || time.Since(start) > 180*time.Millisecond {
		t.Fatalf("UDP cancellation did not release read: %v, elapsed=%s", err, time.Since(start))
	}
}
