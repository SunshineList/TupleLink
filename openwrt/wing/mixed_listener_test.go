// SPDX-License-Identifier: AGPL-3.0-only
package dae

import (
	"context"
	"errors"
	"net"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestRouterMixedBindFailureIsIsolated(t *testing.T) {
	for _, code := range []struct {
		err  error
		code string
	}{
		{&net.OpError{Err: syscall.EADDRINUSE}, "port_in_use"},
		{&net.OpError{Err: syscall.EADDRNOTAVAIL}, "lan_unavailable"},
		{errors.New("unexpected failure"), "bind_failed"},
	} {
		t.Run(code.code, func(t *testing.T) {
			var runtime routerMixedRuntime
			stop, err := runtime.start("127.0.0.1:7893", "", func(string, string) (net.Listener, error) { return nil, code.err }, func(context.Context, net.Listener) error { t.Fatal("must not serve"); return nil })
			if err == nil || stop == nil {
				t.Fatal("failure must return an error and safe cleanup")
			}
			stop()
			status := runtime.snapshot()
			if status.Listening || !status.Enabled || status.Code != code.code {
				t.Fatal(status)
			}
		})
	}
}
func TestRouterMixedLANUnavailableDoesNotBind(t *testing.T) {
	var runtime routerMixedRuntime
	stop, err := runtime.start("", "lan_unavailable", func(string, string) (net.Listener, error) { t.Fatal("must not bind"); return nil, nil }, nil)
	if err == nil {
		t.Fatal("expected setup error")
	}
	stop()
	if runtime.snapshot().Code != "lan_unavailable" {
		t.Fatal(runtime.snapshot())
	}
}

type mixedTestListener struct {
	closed chan struct{}
	once   sync.Once
}

func (l *mixedTestListener) Close() error              { l.once.Do(func() { close(l.closed) }); return nil }
func (l *mixedTestListener) Accept() (net.Conn, error) { <-l.closed; return nil, net.ErrClosed }
func (l *mixedTestListener) Addr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 7893}
}
func TestRouterMixedRuntimeLifecycleAndConcurrentReads(t *testing.T) {
	var runtime routerMixedRuntime
	listener := &mixedTestListener{closed: make(chan struct{})}
	stop, err := runtime.start("127.0.0.1:7893", "", func(string, string) (net.Listener, error) { return listener, nil }, func(ctx context.Context, l net.Listener) error { <-ctx.Done(); return nil })
	if err != nil || !runtime.snapshot().Listening {
		t.Fatal(runtime.snapshot(), err)
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 1000 {
				runtime.snapshot()
			}
		}()
	}
	stop()
	wg.Wait()
	deadline := time.Now().Add(time.Second)
	for runtime.snapshot().Listening && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if status := runtime.snapshot(); status.Listening || status.Code != "listener_stopped" {
		t.Fatal(status)
	}
}
