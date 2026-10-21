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
	"github.com/stretchr/testify/require"
)

func restartTestCache(now time.Time) *control.DnsCache {
	return &control.DnsCache{RouteOwnerKey: "ai.example.1", DomainBitmap: []uint32{99}, Answer: []dnsmessage.RR{&dnsmessage.A{Hdr: dnsmessage.RR_Header{Name: "ai.example.", Rrtype: dnsmessage.TypeA, Class: dnsmessage.ClassINET, Ttl: 300}, A: net.IPv4(203, 0, 113, 9)}}, Deadline: now.Add(4 * time.Minute), OriginalDeadline: now.Add(3 * time.Minute)}
}

func TestRouterRestartRoundTripPreservesTTLAndRebuildsRoutes(t *testing.T) {
	now := time.Now().UTC()
	conf := &daeConfig.Config{}
	cache := restartTestCache(now)
	data, err := encodeRestartState(conf, map[string]*control.DnsCache{"ai.example.1": cache}, now)
	require.NoError(t, err)
	got, err := decodeRestartState(data, conf, now.Add(time.Minute))
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.True(t, got["ai.example.1"].OriginalDeadline.Equal(cache.OriginalDeadline))
	require.Equal(t, cache.RouteOwnerKey, got["ai.example.1"].RouteOwnerKey)
	require.Nil(t, got["ai.example.1"].DomainBitmap, "routing bitmaps must be rebuilt by the current matcher")
	require.Equal(t, cache.Answer[0].String(), got["ai.example.1"].Answer[0].String())
	got, err = decodeRestartState(data, conf, now.Add(3*time.Minute))
	require.NoError(t, err)
	require.Empty(t, got, "the original DNS expiry must never be extended")
	changed := &daeConfig.Config{Node: []daeConfig.KeyableString{"vless://changed"}}
	_, err = decodeRestartState(data, changed, now)
	require.Error(t, err)
	_, err = decodeRestartState(data, conf, now.Add(11*time.Minute))
	require.Error(t, err)
	_, err = decodeRestartState(data, conf, now.Add(-2*time.Second))
	require.Error(t, err)
}

func TestRouterRestartBoundedAndRejectsCorruptState(t *testing.T) {
	now := time.Now()
	conf := &daeConfig.Config{}
	entries := make(map[string]*control.DnsCache)
	for i := 0; i < 2000; i++ {
		entries[fmt.Sprintf("node-%d.example.1", i)] = restartTestCache(now)
	}
	data, err := encodeRestartState(conf, entries, now)
	require.NoError(t, err)
	require.LessOrEqual(t, len(data), routerRestartBytes)
	got, err := decodeRestartState(data, conf, now)
	require.NoError(t, err)
	require.Len(t, got, routerRestartLimit)
	for _, bad := range [][]byte{[]byte("broken"), make([]byte, routerRestartBytes+1)} {
		_, err = decodeRestartState(bad, conf, now)
		require.Error(t, err)
	}
	var state restartState
	require.NoError(t, json.Unmarshal(data, &state))
	state.Entries = []restartDNSEntry{state.Entries[0], state.Entries[0]}
	data, err = json.Marshal(state)
	require.NoError(t, err)
	_, err = decodeRestartState(data, conf, now)
	require.Error(t, err)
}

func TestRouterRestartPrivateFileAndConfigurationMatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "restart.json")
	t.Setenv("DAED_RESTART_STATE", path)
	conf := &daeConfig.Config{}
	now := time.Now()
	data, err := encodeRestartState(conf, map[string]*control.DnsCache{"ai.example.1": restartTestCache(now)}, now)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, data, 0600))
	log := logrus.New()
	require.Len(t, routerRestoreRestartDNS(log, conf, nil), 1)
	require.NoError(t, os.Chmod(path, 0644))
	require.Empty(t, routerRestoreRestartDNS(log, conf, nil))
	require.Equal(t, 0, routerRecoveryCount)
	require.NoError(t, os.Remove(path))
	require.NoError(t, os.Symlink(filepath.Join(filepath.Dir(path), "missing"), path))
	require.Empty(t, routerRestoreRestartDNS(log, conf, nil))
	// A hot reload must keep its newer in-memory state instead of loading disk.
	existing := map[string]*control.DnsCache{"new.example.1": restartTestCache(now)}
	require.Equal(t, existing, routerRestoreRestartDNS(log, conf, existing))
}

func TestRouterReadinessIgnoresRetiredGeneration(t *testing.T) {
	defer func() { currentControlPlane.Store(nil); routerServingPlane = nil; routerConfigured = false }()
	old, next := new(control.ControlPlane), new(control.ControlPlane)
	routerPublishControlPlane(old, &daeConfig.Config{})
	routerMarkServing(old)
	require.True(t, ReadRouterReadiness(false).Listening)
	routerPublishControlPlane(next, &daeConfig.Config{})
	routerMarkServing(old)
	status := ReadRouterReadiness(false)
	require.False(t, status.Listening)
	require.False(t, status.Ready)
	require.Equal(t, "dataplane_starting", status.Phase)
	routerPublishControlPlane(next, EmptyConfig)
	status = ReadRouterReadiness(false)
	require.True(t, status.Ready)
	require.Equal(t, "inactive", status.Phase)
}
