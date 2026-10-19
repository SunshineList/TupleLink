// SPDX-License-Identifier: AGPL-3.0-only
package node

import (
	"context"
	"errors"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/daeuniverse/dae-wing/db"
	dialer "github.com/daeuniverse/dae/component/outbound/dialer"
)

func latencyOptionFixture(t *testing.T) {
	t.Helper()
	if err := db.InitDatabase(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	db.SetOutput(io.Discard)
	if err := db.DB(context.Background()).Create(&db.Config{Global: "global{}", Selected: true}).Error; err != nil {
		t.Fatal(err)
	}
	latencyOptions.Lock()
	latencyOptions.global, latencyOptions.option, latencyOptions.err, latencyOptions.expires = "", nil, nil, time.Time{}
	latencyOptions.Unlock()
	previous := parseLatencyTarget
	t.Cleanup(func() { parseLatencyTarget = previous })
}

func TestRouterLatencyTargetWaiterCanCancel(t *testing.T) {
	latencyOptionFixture(t)
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	parseLatencyTarget = func(ctx context.Context, _ []string, method, network string) (*dialer.TcpCheckOption, error) {
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		return dialer.ParseTcpCheckOption(ctx, []string{"http://127.0.0.1", "127.0.0.1"}, method, network)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := latencyProbeOption(ctx); done <- err }()
	defer func() { once.Do(func() { close(release) }); <-done }()
	<-started
	waiter, stop := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer stop()
	waited := make(chan error, 1)
	go func() { _, err := latencyProbeOption(waiter); waited <- err }()
	select {
	case err := <-waited:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatal(err)
		}
	case <-time.After(300 * time.Millisecond):
		t.Fatal("cancelled test waited for another request's DNS resolution")
	}
}

func TestRouterLatencyTargetCancellationDoesNotPoisonCache(t *testing.T) {
	latencyOptionFixture(t)
	parseLatencyTarget = func(ctx context.Context, _ []string, _, _ string) (*dialer.TcpCheckOption, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := latencyProbeOption(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	if len(latencyOptionSlot) != 0 || latencyOptions.err != nil {
		t.Fatal("cancelled DNS retained test slot or cached a shared failure")
	}
	parseLatencyTarget = func(ctx context.Context, _ []string, method, network string) (*dialer.TcpCheckOption, error) {
		return dialer.ParseTcpCheckOption(ctx, []string{"http://127.0.0.1", "127.0.0.1"}, method, network)
	}
	if _, err := latencyProbeOption(context.Background()); err != nil {
		t.Fatal("healthy test could not resume:", err)
	}
}

func TestRouterLatencyTargetConcurrentRequestsShareResolution(t *testing.T) {
	latencyOptionFixture(t)
	var calls atomic.Int32
	parseLatencyTarget = func(ctx context.Context, _ []string, method, network string) (*dialer.TcpCheckOption, error) {
		calls.Add(1)
		return dialer.ParseTcpCheckOption(ctx, []string{"http://127.0.0.1", "127.0.0.1"}, method, network)
	}
	var workers sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			option, err := latencyProbeOption(context.Background())
			if err != nil || option == nil {
				t.Error("target setup failed", err)
			}
		}()
	}
	workers.Wait()
	if calls.Load() != 1 {
		t.Fatalf("target was resolved %d times", calls.Load())
	}
}
