// SPDX-License-Identifier: AGPL-3.0-only
package node

import (
	"bufio"
	"context"
	"github.com/daeuniverse/dae-wing/db"
	dialer "github.com/daeuniverse/dae/component/outbound/dialer"
	"github.com/graph-gophers/graphql-go"
	"github.com/sirupsen/logrus"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRouterLatencyThroughRealSocksAndCancellation(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			c, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				_ = c.SetDeadline(time.Now().Add(3 * time.Second))
				greeting := make([]byte, 2)
				if _, err := io.ReadFull(c, greeting); err != nil {
					return
				}
				_, _ = io.CopyN(io.Discard, c, int64(greeting[1]))
				_, _ = c.Write([]byte{5, 0})
				header := make([]byte, 4)
				if _, err := io.ReadFull(c, header); err != nil {
					return
				}
				length := 0
				switch header[3] {
				case 1:
					length = 4
				case 4:
					length = 16
				case 3:
					b := make([]byte, 1)
					_, _ = io.ReadFull(c, b)
					length = int(b[0])
				}
				_, _ = io.CopyN(io.Discard, c, int64(length+2))
				_, _ = c.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 80})
				request, err := http.ReadRequest(bufio.NewReader(c))
				if err != nil {
					return
				}
				if request.URL.Path == "/slow" {
					time.Sleep(500 * time.Millisecond)
				}
				time.Sleep(20 * time.Millisecond)
				_, _ = io.WriteString(c, "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
			}()
		}
	}()
	log := logrus.New()
	log.SetOutput(io.Discard)
	option := &dialer.GlobalOption{Log: log, CheckInterval: time.Minute, TcpCheckOptionRaw: dialer.TcpCheckOptionRaw{Log: log, Raw: []string{"http://127.0.0.1/generate_204", "127.0.0.1"}, Method: http.MethodGet, ResolverNetwork: "udp"}}
	n := db.Node{Link: "socks5://" + listener.Addr().String() + "#Fixture"}
	n.ID = 7
	result := testSingleNodeLatency(context.Background(), option, &n)
	if !result.AliveVal || result.LatencyMsV == nil || *result.LatencyMsV < 10 || result.NodeID != 7 {
		t.Fatalf("real HTTP-over-proxy latency failed: %#v", result)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	result = testSingleNodeLatency(ctx, option, &n)
	if result.AliveVal || time.Since(start) > time.Second {
		t.Fatal("cancelled probe did not stop promptly")
	}
	option.TcpCheckOptionRaw.Reset()
	option.TcpCheckOptionRaw.Raw = []string{"http://127.0.0.1/slow", "127.0.0.1"}
	ctx, cancel = context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	start = time.Now()
	result = testSingleNodeLatency(ctx, option, &n)
	if result.AliveVal || time.Since(start) > 300*time.Millisecond {
		t.Fatal("active slow proxy probe did not respect cancellation")
	}
}

func TestRouterLatencyBatchLimit(t *testing.T) {
	ids := make([]graphql.ID, 9)
	if _, err := TestLatencies(context.Background(), &ids); err == nil || !strings.Contains(err.Error(), "8 nodes") {
		t.Fatalf("expected pre-DB limit error, got %v", err)
	}
}

func TestRouterLatencyQueryDoesNotProbe(t *testing.T) {
	if err := db.InitDatabase(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	// No selected configuration exists: the old read path would fail before
	// returning anything, as it tried to create new probe dialers on every poll.
	if err := db.DB(context.Background()).Create(&db.Node{Link: "invalid-private-node", Name: "fixture"}).Error; err != nil {
		t.Fatal(err)
	}
	result, err := QueryLatencies(context.Background(), nil)
	if err != nil || len(result) != 0 {
		t.Fatalf("cache read should not dial or need a selected config: %v %v", result, err)
	}
}

func TestRouterLatencyCancellationAndConcurrency(t *testing.T) {
	nodes := make([]db.Node, 8)
	for i := range nodes {
		nodes[i].ID = uint(i + 1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	var started, active, peak atomic.Int32
	start := time.Now()
	result, err := runLatencyProbes(ctx, nodes, func(ctx context.Context, node *db.Node) *LatencyResolver {
		n := active.Add(1)
		for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
		}
		started.Add(1)
		<-ctx.Done()
		active.Add(-1)
		return &LatencyResolver{NodeID: node.ID}
	})
	if err != context.DeadlineExceeded || result != nil || started.Load() != 8 || active.Load() != 0 || peak.Load() > 8 || time.Since(start) > time.Second {
		t.Fatalf("unbounded/cancelled probes: err=%v started=%d active=%d peak=%d", err, started.Load(), active.Load(), peak.Load())
	}
}

func TestRouterLatencyResultsKeepIDsAndOrder(t *testing.T) {
	nodes := []db.Node{{}, {}}
	nodes[0].ID = 7
	nodes[1].ID = 3
	results, err := runLatencyProbes(context.Background(), nodes, func(_ context.Context, n *db.Node) *LatencyResolver {
		return &LatencyResolver{NodeID: n.ID, AliveVal: true}
	})
	if err != nil || results[0].NodeID != 7 || results[1].NodeID != 3 {
		t.Fatalf("lost result IDs/order: %v %v", results, err)
	}
}
