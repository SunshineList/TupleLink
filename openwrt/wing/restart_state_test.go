// SPDX-License-Identifier: AGPL-3.0-only
package dae

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	daeConfig "github.com/daeuniverse/dae/config"
	"github.com/daeuniverse/dae/control"
	dnsmessage "github.com/miekg/dns"
	"github.com/sirupsen/logrus"
)

func restartCheck(t *testing.T, condition bool, message string) {
	t.Helper()
	if !condition {
		t.Fatal(message)
	}
}

func restartNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func restartTestCache(now time.Time) *control.DnsCache {
	return &control.DnsCache{RouteOwnerKey: "ai.example.1", DomainBitmap: []uint32{99}, Answer: []dnsmessage.RR{&dnsmessage.A{Hdr: dnsmessage.RR_Header{Name: "ai.example.", Rrtype: dnsmessage.TypeA, Class: dnsmessage.ClassINET, Ttl: 300}, A: net.IPv4(203, 0, 113, 9)}}, Deadline: now.Add(4 * time.Minute), OriginalDeadline: now.Add(3 * time.Minute)}
}

func TestRouterRestartRoundTripPreservesTTLAndRebuildsRoutes(t *testing.T) {
	now := time.Now().UTC()
	conf := &daeConfig.Config{}
	cache := restartTestCache(now)
	data, err := encodeRestartState(conf, map[string]*control.DnsCache{"ai.example.1": cache}, now)
	restartNoError(t, err)
	got, err := decodeRestartState(data, conf, now.Add(time.Minute))
	restartNoError(t, err)
	restartCheck(t, len(got) == 1 && got["ai.example.1"] != nil, "address was not restored")
	restartCheck(t, got["ai.example.1"].OriginalDeadline.Equal(cache.OriginalDeadline), "original TTL changed")
	restartCheck(t, cache.RouteOwnerKey == got["ai.example.1"].RouteOwnerKey, "route owner changed")
	restartCheck(t, got["ai.example.1"].DomainBitmap == nil, "routing bitmaps must be rebuilt by the current matcher")
	restartCheck(t, cache.Answer[0].String() == got["ai.example.1"].Answer[0].String(), "DNS payload changed")
	got, err = decodeRestartState(data, conf, now.Add(3*time.Minute))
	restartNoError(t, err)
	restartCheck(t, len(got) == 0, "the original DNS expiry must never be extended")
	changed := &daeConfig.Config{Node: []daeConfig.KeyableString{"vless://changed"}}
	_, err = decodeRestartState(data, changed, now)
	restartCheck(t, err != nil, "configuration mismatch was accepted")
	_, err = decodeRestartState(data, conf, now.Add(11*time.Minute))
	restartCheck(t, err != nil, "old snapshot was accepted")
	_, err = decodeRestartState(data, conf, now.Add(-2*time.Second))
	restartCheck(t, err != nil, "future snapshot was accepted")
}

func TestRouterRestartBoundedAndRejectsCorruptState(t *testing.T) {
	now := time.Now()
	conf := &daeConfig.Config{}
	entries := make(map[string]*control.DnsCache)
	for i := 0; i < 2000; i++ {
		entries[fmt.Sprintf("node-%d.example.1", i)] = restartTestCache(now)
	}
	data, err := encodeRestartState(conf, entries, now)
	restartNoError(t, err)
	restartCheck(t, len(data) <= routerRestartBytes, "encoded state exceeds byte limit")
	got, err := decodeRestartState(data, conf, now)
	restartNoError(t, err)
	restartCheck(t, len(got) == routerRestartLimit, "entry limit was not applied")
	for _, bad := range [][]byte{[]byte("broken"), make([]byte, routerRestartBytes+1)} {
		_, err = decodeRestartState(bad, conf, now)
		restartCheck(t, err != nil, "corrupt or oversized state was accepted")
	}
	var state restartState
	restartNoError(t, json.Unmarshal(data, &state))
	state.Entries = []restartDNSEntry{state.Entries[0], state.Entries[0]}
	data, err = json.Marshal(state)
	restartNoError(t, err)
	_, err = decodeRestartState(data, conf, now)
	restartCheck(t, err != nil, "duplicate DNS key was accepted")
}

func TestRouterRestartPrivateFileAndConfigurationMatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "restart.json")
	t.Setenv("DAED_RESTART_STATE", path)
	conf := &daeConfig.Config{}
	now := time.Now()
	data, err := encodeRestartState(conf, map[string]*control.DnsCache{"ai.example.1": restartTestCache(now)}, now)
	restartNoError(t, err)
	restartNoError(t, os.WriteFile(path, data, 0600))
	log := logrus.New()
	restartCheck(t, len(routerRestoreRestartDNS(log, conf, nil)) == 1, "private file was not restored")
	restartNoError(t, os.Chmod(path, 0644))
	restartCheck(t, len(routerRestoreRestartDNS(log, conf, nil)) == 0, "public file was accepted")
	restartCheck(t, routerRecoveryCount == 0, "recovery count is stale")
	restartNoError(t, os.Remove(path))
	restartNoError(t, os.Symlink(filepath.Join(filepath.Dir(path), "missing"), path))
	restartCheck(t, len(routerRestoreRestartDNS(log, conf, nil)) == 0, "symbolic link was accepted")
	// A hot reload must keep its newer in-memory state instead of loading disk.
	existing := map[string]*control.DnsCache{"new.example.1": restartTestCache(now)}
	restartCheck(t, routerRestoreRestartDNS(log, conf, existing)["new.example.1"] == existing["new.example.1"], "hot reload state was replaced")
}

func TestRouterReadinessIgnoresRetiredGeneration(t *testing.T) {
	defer func() { currentControlPlane.Store(nil); routerServingPlane = nil; routerConfigured = false }()
	old, next := new(control.ControlPlane), new(control.ControlPlane)
	routerPublishControlPlane(old, &daeConfig.Config{})
	routerMarkServing(old)
	restartCheck(t, ReadRouterReadiness(false).Listening, "serving generation was not recorded")
	routerPublishControlPlane(next, &daeConfig.Config{})
	routerMarkServing(old)
	status := ReadRouterReadiness(false)
	restartCheck(t, !status.Listening && !status.Ready && status.Phase == "dataplane_starting", "retired generation marked new plane ready")
	routerPublishControlPlane(next, EmptyConfig)
	status = ReadRouterReadiness(false)
	restartCheck(t, status.Ready && status.Phase == "inactive", "inactive management plane is not ready")
}
