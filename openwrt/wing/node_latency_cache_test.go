// SPDX-License-Identifier: AGPL-3.0-only
package node

import (
	"testing"

	"github.com/daeuniverse/dae-wing/db"
	"github.com/graph-gophers/graphql-go"
)

func TestRouterLatencyCachePrunesDeletedNodesWithoutDiscardingConcurrentWrites(t *testing.T) {
	nodeLatencyCache.mu.Lock()
	previous := nodeLatencyCache.items
	nodeLatencyCache.items = make(map[uint]*LatencyResolver)
	nodeLatencyCache.mu.Unlock()
	t.Cleanup(func() { nodeLatencyCache.mu.Lock(); nodeLatencyCache.items = previous; nodeLatencyCache.mu.Unlock() })
	storeLatencyResults([]*LatencyResolver{{NodeID: 1}, {NodeID: 2}, {NodeID: 3}})
	before := latencyCacheEntriesBeforeQuery(nil)
	storeLatencyResults([]*LatencyResolver{{NodeID: 3}, {NodeID: 4}})
	results := latencyCacheForNodes([]db.Node{{ID: 1}}, true, before)
	if len(results) != 1 || results[1] == nil {
		t.Fatalf("incorrect query results: %v", results)
	}
	cache := snapshotCachedLatencyResults()
	if cache[2] != nil || cache[3] == nil || cache[4] == nil {
		t.Fatal("deleted results retained or concurrent writes discarded")
	}
	ids := []graphql.ID{}
	if latencyCacheEntriesBeforeQuery(&ids) != nil {
		t.Fatal("scoped query copied the entire cache")
	}
	latencyCacheForNodes(nil, false, nil)
	if len(snapshotCachedLatencyResults()) != 3 {
		t.Fatal("a scoped query pruned unrelated nodes")
	}
	latencyCacheForNodes([]db.Node{{ID: 1}}, true, latencyCacheEntriesBeforeQuery(nil))
	if len(snapshotCachedLatencyResults()) != 1 {
		t.Fatal("subsequent full query did not prune obsolete writes")
	}
}
