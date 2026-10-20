// SPDX-License-Identifier: AGPL-3.0-only
package node

import (
	"context"
	"errors"
	"github.com/daeuniverse/dae-wing/db"
	"github.com/graph-gophers/graphql-go"
	"io"
	"net/netip"
	"sync/atomic"
	"testing"
	"time"
)

func TestRouterUDPFirstFamilyWinsAndDrainsCancellation(t *testing.T) {
	var cancelled atomic.Bool
	ready := make(chan struct{})
	err := probeUDP(context.Background(), []netip.Addr{netip.MustParseAddr("127.0.0.1"), netip.MustParseAddr("::1")}, func(ctx context.Context, ip netip.Addr) error {
		if ip.Is4() {
			<-ready
			return nil
		}
		close(ready)
		<-ctx.Done()
		cancelled.Store(true)
		return ctx.Err()
	})
	if err != nil || !cancelled.Load() {
		t.Fatalf("cancellation was not drained: %v", err)
	}
}

func TestRouterUDPParentCancellationAndUnsupportedPrivacy(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := probeUDP(ctx, []netip.Addr{netip.MustParseAddr("127.0.0.1")}, func(ctx context.Context, _ netip.Addr) error { <-ctx.Done(); return ctx.Err() })
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if udpFailureCode(errors.New("udp is not supported: protocol://password@server")) != "udp_unsupported" {
		t.Fatal("unsafe or incorrect failure")
	}
	if udpFailureCode(errors.New("secret://credential@provider")) != "unreachable" {
		t.Fatal("provider data leaked")
	}
}

func TestRouterUDPRequestBoundsAndMissingNode(t *testing.T) {
	if err := db.InitDatabase(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	db.SetOutput(io.Discard)
	for i := 0; i < cap(latencyRequestSlot); i++ {
		latencyRequestSlot <- struct{}{}
	}
	_, err := TestNodeUDP(context.Background(), graphql.ID("invalid"))
	for i := 0; i < cap(latencyRequestSlot); i++ {
		<-latencyRequestSlot
	}
	if err == nil {
		t.Fatal("request limit bypassed")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, err = TestNodeUDP(ctx, graphql.ID("invalid"))
	if err == nil || len(latencyRequestSlot) != 0 || len(latencyProbeSlots) != 0 {
		t.Fatal("missing node leaked slots", err)
	}
}
