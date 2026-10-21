// SPDX-License-Identifier: AGPL-3.0-only
package control

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync/atomic"
	"testing"
	"time"

	dnsmessage "github.com/miekg/dns"
	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
)

func TestRouterDNSRestoreWaitsForEveryRoutingBinding(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	c, err := NewDnsController(nil, &DnsControllerOption{Log: logrus.New(), CacheAccessCallback: func(cache *DnsCache) error {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
		}
		if len(cache.DomainBitmap) != 1 || cache.DomainBitmap[0] != 42 {
			return errors.New("obsolete domain route")
		}
		return nil
	}})
	require.NoError(t, err)
	t.Cleanup(func() { c.Close() })
	now := time.Now()
	entries := make(map[string]*DnsCache)
	// Exceed the asynchronous queue's capacity. A browser using its DNS cache
	// cannot be relied upon to generate another request to retry a lost binding.
	for i := 0; i < 1300; i++ {
		name := fmt.Sprintf("ai-%d.example.", i)
		entries[name+"1"] = &DnsCache{DomainBitmap: []uint32{1}, Answer: []dnsmessage.RR{&dnsmessage.A{Hdr: dnsmessage.RR_Header{Name: name, Rrtype: dnsmessage.TypeA, Class: dnsmessage.ClassINET, Ttl: 60}, A: net.IPv4(203, 0, 113, 1)}}, Deadline: now.Add(time.Minute), OriginalDeadline: now.Add(time.Minute)}
	}
	done := make(chan int, 1)
	go func() { done <- c.RestoreReloadCache(entries, func(string) []uint32 { return []uint32{42} }, now) }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("route callback did not start")
	}
	select {
	case <-done:
		close(release)
		t.Fatal("restore returned while DNS routing bindings were still pending")
	case <-time.After(40 * time.Millisecond):
	}
	close(release)
	select {
	case count := <-done:
		require.Equal(t, 1300, count)
	case <-time.After(3 * time.Second):
		t.Fatal("restore blocked")
	}
	require.EqualValues(t, 1300, calls.Load())
	require.False(t, c.routerReplayFailed.Load())
}

func TestRouterDNSRestoreReportsRoutingFailure(t *testing.T) {
	c, err := NewDnsController(nil, &DnsControllerOption{Log: logrus.New(), CacheAccessCallback: func(*DnsCache) error { return errors.New("map write rejected") }})
	require.NoError(t, err)
	defer c.Close()
	c.RestoreReloadCache(map[string]*DnsCache{"ai.example.1": {Answer: []dnsmessage.RR{&dnsmessage.A{Hdr: dnsmessage.RR_Header{Name: "ai.example.", Rrtype: dnsmessage.TypeA}, A: net.IPv4(203, 0, 113, 1)}}}}, nil, time.Now())
	require.True(t, c.routerReplayFailed.Load())
}

func TestRouterDNSSnapshotKeepsOnlyFreshAddresses(t *testing.T) {
	c, err := NewDnsController(nil, &DnsControllerOption{Log: logrus.New()})
	require.NoError(t, err)
	defer c.Close()
	now := time.Now()
	address := func() *DnsCache {
		return &DnsCache{Answer: []dnsmessage.RR{&dnsmessage.A{Hdr: dnsmessage.RR_Header{Name: "ai.example.", Rrtype: dnsmessage.TypeA}, A: net.IPv4(203, 0, 113, 1)}}, Deadline: now.Add(time.Minute), OriginalDeadline: now.Add(time.Minute)}
	}
	c.dnsCache.Store("ai.example.1", address())
	expired := address()
	expired.OriginalDeadline = now.Add(-time.Second)
	c.dnsCache.Store("expired.example.1", expired)
	c.dnsCache.Store("text.example.16", &DnsCache{Answer: []dnsmessage.RR{&dnsmessage.TXT{Hdr: dnsmessage.RR_Header{Name: "text.example.", Rrtype: dnsmessage.TypeTXT}, Txt: []string{"not an address"}}}, Deadline: now.Add(time.Minute), OriginalDeadline: now.Add(time.Minute)})
	plane := &ControlPlane{ctx: context.Background(), controlPlaneDNSRuntime: controlPlaneDNSRuntime{dnsController: c}}
	got := plane.SnapshotRestartDNS(10, now)
	require.Len(t, got, 1)
	require.Contains(t, got, "ai.example.1")
	require.Empty(t, plane.SnapshotRestartDNS(0, now))
	require.Empty(t, plane.SnapshotRestartDNS(10, now.Add(2*time.Minute)))
}

func TestRouterDNSDiagnosticRedactsLinks(t *testing.T) {
	require.Equal(t, "[redacted]", routerDiagnosticLabel("vless://secret@example.com"))
	require.Len(t, []rune(routerDiagnosticLabel(string(make([]rune, 120)))), 80)
}
