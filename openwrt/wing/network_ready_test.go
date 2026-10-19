// SPDX-License-Identifier: AGPL-3.0-only
package dae

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestRouterNetworkReadinessBoundsUnresponsiveTarget(t *testing.T) {
	closed := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
		closed <- struct{}{}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := waitForRouterNetwork(ctx, server.Client(), []string{server.URL}, time.Millisecond)
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > time.Second {
		t.Fatalf("unbounded readiness wait: %v", err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("readiness deadline left an active connection")
	}
}

func TestRouterNetworkReadinessTriesAnotherTarget(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path == "/blocked" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := waitForRouterNetwork(ctx, server.Client(), []string{server.URL + "/blocked", server.URL}, time.Millisecond); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("readiness requests = %d, want 2", calls.Load())
	}
}

func TestRouterNetworkReadinessCancelsRetryDelay(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := waitForRouterNetwork(ctx, server.Client(), []string{server.URL}, time.Hour); !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > time.Second {
		t.Fatalf("retry sleep ignored cancellation: %v", err)
	}
}
