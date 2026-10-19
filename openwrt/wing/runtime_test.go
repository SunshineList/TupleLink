//go:build daed_runtime_test

package dae

import (
	"bytes"
	"context"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/daeuniverse/dae/control"
)

func useRuntimePlane(t *testing.T) *control.ControlPlane {
	t.Helper()
	previous := currentControlPlane.Load()
	plane := control.NewRuntimeStatsFixture()
	currentControlPlane.Store(plane)
	t.Cleanup(func() { currentControlPlane.Store(previous) })
	return plane
}

func runtimeTCPPair(t *testing.T) (net.Conn, net.Conn) {
	t.Helper()
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	listener.SetDeadline(time.Now().Add(5 * time.Second))
	client, err := net.DialTimeout("tcp4", listener.Addr().String(), 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	server, err := listener.AcceptTCP()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close() })
	return client, server
}

func assertRuntimeTraffic(t *testing.T, upload, download uint64) {
	t.Helper()
	overview, err := GetRuntimeOverview(60, 240)
	if err != nil {
		t.Fatal(err)
	}
	if overview.UploadTotal != upload || overview.DownloadTotal != download {
		t.Fatalf("overview totals = %d/%d, want %d/%d", overview.UploadTotal, overview.DownloadTotal, upload, download)
	}
	if overview.UploadRate == 0 || overview.DownloadRate == 0 {
		t.Fatal("live rates must be nonzero")
	}
	if len(overview.Samples) == 0 {
		t.Fatal("traffic chart has no samples")
	}
	var hasUpload, hasDownload bool
	for _, sample := range overview.Samples {
		hasUpload = hasUpload || sample.UploadRate > 0
		hasDownload = hasDownload || sample.DownloadRate > 0
	}
	if !hasUpload || !hasDownload {
		t.Fatal("traffic chart lost nonzero samples")
	}
}

func TestRuntimeOverviewReadsLiveTCPInstance(t *testing.T) {
	plane := useRuntimePlane(t)
	// Contaminate the legacy store so a regression cannot pass using that store.
	control.RecordUploadTraffic(17)
	control.RecordDownloadTraffic(19)
	client, incoming := runtimeTCPPair(t)
	outgoing, upstream := runtimeTCPPair(t)
	for _, conn := range []net.Conn{client, incoming, outgoing, upstream} {
		defer conn.Close()
		conn.SetDeadline(time.Now().Add(5 * time.Second))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- control.RelayRuntimeStatsFixture(ctx, plane, incoming, outgoing) }()
	upload, download := bytes.Repeat([]byte("upload"), 4096), bytes.Repeat([]byte("download"), 4096)
	for _, step := range []struct {
		from, to net.Conn
		payload  []byte
	}{{client, upstream, upload}, {upstream, client, download}} {
		written := make(chan error, 1)
		go func() { _, err := step.from.Write(step.payload); written <- err }()
		got := make([]byte, len(step.payload))
		if _, err := io.ReadFull(step.to, got); err != nil {
			t.Fatal(err)
		}
		if err := <-written; err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, step.payload) {
			t.Fatal("relay corrupted payload")
		}
	}
	// Recorders run after writes; wait only for their bookkeeping, not relay close.
	deadline := time.Now().Add(time.Second)
	for {
		snapshot := plane.SnapshotRuntimeStats(60, 240)
		if snapshot.UploadTotal == uint64(len(upload)) && snapshot.DownloadTotal == uint64(len(download)) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("core did not record live bytes")
		}
		time.Sleep(time.Millisecond)
	}
	assertRuntimeTraffic(t, uint64(len(upload)), uint64(len(download)))
	overview, _ := GetRuntimeOverview(60, 240)
	if overview.ActiveConnections != 1 {
		t.Fatalf("active connections = %d, want 1", overview.ActiveConnections)
	}
	client.Close()
	upstream.Close()
	<-done
	// Closing the browser / changing chart windows must not reset totals.
	overview, err := GetRuntimeOverview(3600, 2)
	if err != nil || overview.UploadTotal != uint64(len(upload)) || overview.DownloadTotal != uint64(len(download)) {
		t.Fatal("window change reset totals", err)
	}
}

func TestRuntimeOverviewReadsUDPAndNewInstance(t *testing.T) {
	plane := useRuntimePlane(t)
	server, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	client, err := net.DialUDP("udp4", nil, server.LocalAddr().(*net.UDPAddr))
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	server.SetDeadline(time.Now().Add(5 * time.Second))
	client.SetDeadline(time.Now().Add(5 * time.Second))
	done := make(chan error, 1)
	go func() { done <- control.EchoRuntimeUDPFixture(plane, server) }()
	payload := []byte("real UDP accounting regression")
	if _, err := client.Write(payload); err != nil {
		t.Fatal(err)
	}
	got := make([]byte, 2048)
	n, err := client.Read(got)
	if err != nil || !bytes.Equal(got[:n], payload) {
		t.Fatal("UDP echo failed", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	assertRuntimeTraffic(t, uint64(len(payload)), uint64(len(payload)))
	// Reload selects the new instance; the old plane's bytes must not leak in.
	currentControlPlane.Store(control.NewRuntimeStatsFixture())
	overview, err := GetRuntimeOverview(60, 240)
	if err != nil || overview.UploadTotal != 0 || overview.DownloadTotal != 0 {
		t.Fatal("old plane leaked into overview", err)
	}
}

func TestRuntimeOverviewWithoutProxyIgnoresLegacyTraffic(t *testing.T) {
	previous := currentControlPlane.Load()
	currentControlPlane.Store(nil)
	defer currentControlPlane.Store(previous)
	control.RecordUploadTraffic(101)
	control.RecordDownloadTraffic(103)
	overview, err := GetRuntimeOverview(60, 240)
	if err != nil {
		t.Fatal(err)
	}
	if overview.UploadTotal != 0 || overview.DownloadTotal != 0 || overview.ActiveConnections != 0 || overview.UDPSessions != 0 || overview.UpdatedAt.IsZero() {
		t.Fatalf("invalid stopped overview: %+v", overview)
	}
}

func TestRuntimeOverviewConcurrentPlaneReplacement(t *testing.T) {
	previous := currentControlPlane.Load()
	defer currentControlPlane.Store(previous)
	planes := []*control.ControlPlane{control.NewRuntimeStatsFixture(), control.NewRuntimeStatsFixture(), nil}
	var workers sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for attempt := 0; attempt < 200; attempt++ {
				if _, err := GetRuntimeOverview(60, 20); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	for attempt := 0; attempt < 600; attempt++ {
		currentControlPlane.Store(planes[attempt%len(planes)])
	}
	workers.Wait()
}
