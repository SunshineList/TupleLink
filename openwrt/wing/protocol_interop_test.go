// SPDX-License-Identifier: AGPL-3.0-only
package node

import (
	"context"
	"encoding/json"
	"github.com/daeuniverse/dae-wing/db"
	dialer "github.com/daeuniverse/dae/component/outbound/dialer"
	D "github.com/daeuniverse/outbound/dialer"
	"github.com/daeuniverse/outbound/netproxy"
	"github.com/sirupsen/logrus"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRouterProtocolInteroperability(t *testing.T) {
	path := os.Getenv("DAED_PROTOCOL_CASES")
	if path == "" {
		t.Skip("independent loopback server required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Target string
		UDP    string
		Cases  []struct{ Name, Link, Failure string }
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			log := logrus.New()
			log.SetOutput(io.Discard)
			option := &dialer.GlobalOption{Log: log, ExtraOption: D.ExtraOption{TlsImplementation: "tls", UtlsImitate: "chrome_auto"}, CheckInterval: time.Minute, TcpCheckOptionRaw: dialer.TcpCheckOptionRaw{Log: log, Raw: []string{fixture.Target + "/generate_204", "127.0.0.1"}, Method: http.MethodGet, ResolverNetwork: "udp"}}
			option.UDPHopInterval = 5 * time.Second
			if c.Failure != "" {
				result := testSingleNodeLatency(context.Background(), option, &db.Node{Link: c.Link})
				if result.AliveVal || result.MessageV == nil || *result.MessageV != c.Failure {
					t.Fatalf("unexpected failure category: %+v", result)
				}
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
			defer cancel()
			d, err := dialer.NewFromLinkContext(ctx, option, dialer.InstanceOption{DisableCheck: true}, c.Link, "")
			if err != nil {
				t.Fatal(err)
			}
			defer d.Close()
			transport := &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				conn, err := d.DialContext(ctx, network, addr)
				if err != nil {
					return nil, err
				}
				return &netproxy.FakeNetConn{Conn: conn}, nil
			}}
			defer transport.CloseIdleConnections()
			client := &http.Client{Transport: transport, Timeout: 6 * time.Second}
			response, err := client.Get(fixture.Target + "/payload")
			if err != nil {
				t.Fatal("real handshake/payload failed:", err)
			}
			data, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil || string(data) != strings.Repeat("protocol-payload", 4096) {
				t.Fatal("payload mismatch", err)
			}
			t.Log("real independent server handshake and 64 KiB response passed")
			if fixture.UDP != "" {
				packet, err := d.DialContext(ctx, "udp", fixture.UDP)
				if err != nil {
					t.Fatal("UDP proxy dial failed", err)
				}
				defer packet.Close()
				deadline := 2 * time.Second
				if c.Name == "hysteria2-obfs-alias-ports" {
					deadline = 7 * time.Second
				}
				_ = packet.SetDeadline(time.Now().Add(deadline))
				payload := []byte("protocol-udp-fixture")
				if _, err = packet.Write(payload); err != nil {
					t.Fatal("UDP write failed", err)
				}
				buffer := make([]byte, 1024)
				n, err := packet.Read(buffer)
				if err != nil || string(buffer[:n]) != string(payload) {
					t.Fatal("UDP payload failed", err)
				}
				t.Log("real UDP echo passed")
				if c.Name == "hysteria2-obfs-alias-ports" {
					time.Sleep(5200 * time.Millisecond)
					_ = packet.SetDeadline(time.Now().Add(time.Second))
					if _, err = packet.Write(payload); err != nil {
						t.Fatal("UDP write after hop failed", err)
					}
					n, err = packet.Read(buffer)
					if err != nil || string(buffer[:n]) != string(payload) {
						t.Fatal("UDP payload after hop failed", err)
					}
					t.Log("QUIC/Salamander UDP remains usable after socket rotation")
				}
			}
			result := testSingleNodeLatency(context.Background(), option, &db.Node{Link: c.Link})
			if !result.AliveVal {
				t.Fatalf("interactive test failed: %+v", result)
			}
		})
	}
}
