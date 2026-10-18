// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2023, daeuniverse Organization <team@v2raya.org>
package node

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/daeuniverse/dae-wing/common"
	"github.com/daeuniverse/dae-wing/dae"
	"github.com/daeuniverse/dae-wing/db"
	dialer "github.com/daeuniverse/dae/component/outbound/dialer"
	"github.com/graph-gophers/graphql-go"
	"github.com/sirupsen/logrus"
)

const latencyProbeConcurrency = 8
const latencyRequestTimeout = 24 * time.Second

var latencyRequestSlot = make(chan struct{}, 1)

func TestLatencies(ctx context.Context, ids *[]graphql.ID) ([]*LatencyResolver, error) {
	// Bound work before opening dialers. Older callers receive a useful error,
	// rather than tying up CGI workers until the gateway times out.
	if ids != nil && len(*ids) > latencyProbeConcurrency {
		return nil, fmt.Errorf("test at most 8 nodes per request")
	}
	nodes, err := latencyProbeNodes(ctx, ids)
	if err != nil {
		return nil, err
	}
	if len(nodes) > latencyProbeConcurrency {
		return nil, fmt.Errorf("test at most 8 nodes per request")
	}
	if len(nodes) == 0 {
		return []*LatencyResolver{}, nil
	}
	select {
	case latencyRequestSlot <- struct{}{}:
		defer func() { <-latencyRequestSlot }()
	default:
		return nil, fmt.Errorf("latency test already in progress; retry shortly")
	}
	ctx, cancel := context.WithTimeout(ctx, latencyRequestTimeout)
	defer cancel()
	option, err := latencyProbeOption(ctx)
	if err != nil {
		return nil, err
	}
	// Resolve the check target once. Failed lazy DNS otherwise serializes up to
	// eight independent 10-second resolutions behind the option mutex.
	if _, err = option.TcpCheckOptionRaw.Option(); err != nil {
		return nil, fmt.Errorf("cannot resolve latency check target; check DNS or tcp_check_url")
	}
	results, err := runLatencyProbes(ctx, nodes, func(ctx context.Context, n *db.Node) *LatencyResolver { return testSingleNodeLatency(ctx, option, n) })
	if err != nil {
		return nil, err
	}
	storeLatencyResults(results)
	return results, nil
}

func runLatencyProbes(ctx context.Context, nodes []db.Node, probe func(context.Context, *db.Node) *LatencyResolver) ([]*LatencyResolver, error) {
	results := make([]*LatencyResolver, len(nodes))
	var wg sync.WaitGroup
	for index := range nodes {
		index := index
		wg.Add(1)
		go func() { defer wg.Done(); results[index] = probe(ctx, &nodes[index]) }()
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

// Retained for source compatibility with the upstream cache helpers. Queries
// no longer call those helpers; explicit tests use bounded batches above.
func testLatencyResultsForNodes(option *dialer.GlobalOption, nodes []db.Node) []*LatencyResolver {
	ctx, cancel := context.WithTimeout(context.Background(), latencyRequestTimeout)
	defer cancel()
	if len(nodes) > latencyProbeConcurrency {
		return nil
	}
	results, _ := runLatencyProbes(ctx, nodes, func(ctx context.Context, n *db.Node) *LatencyResolver { return testSingleNodeLatency(ctx, option, n) })
	return results
}

func latencyProbeOption(ctx context.Context) (*dialer.GlobalOption, error) {
	var model db.Config
	if err := db.DB(ctx).Where("selected = ?", true).First(&model).Error; err != nil {
		return nil, err
	}
	parsed, err := dae.ParseConfig(&model.Global, nil, nil)
	if err != nil {
		return nil, err
	}
	log := logrus.New()
	log.SetOutput(io.Discard)
	return dialer.NewGlobalOption(&parsed.Global, log), nil
}

func latencyProbeNodes(ctx context.Context, ids *[]graphql.ID) ([]db.Node, error) {
	q := db.DB(ctx).Model(&db.Node{})
	if ids != nil {
		decoded, err := common.DecodeCursorBatch(*ids)
		if err != nil {
			return nil, err
		}
		q = q.Where("id in ?", decoded)
	}
	var nodes []db.Node
	if err := q.Find(&nodes).Error; err != nil {
		return nil, err
	}
	return nodes, nil
}

func testSingleNodeLatency(ctx context.Context, option *dialer.GlobalOption, node *db.Node) *LatencyResolver {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	r := &LatencyResolver{NodeID: node.ID, TestedAtV: time.Now()}
	d, err := dialer.NewFromLinkContext(ctx, option, dialer.InstanceOption{DisableCheck: true}, node.Link, "")
	if err != nil {
		message := "unsupported or invalid node"
		r.MessageV = &message
		return r
	}
	defer d.Close()
	result, err := d.ProbeLatency()
	if err != nil {
		message := "node probe failed"
		r.MessageV = &message
		return r
	}
	r.AliveVal, r.TestedAtV = result.Alive, result.CheckedAt
	if result.Alive {
		ms := int32(result.Latency.Milliseconds())
		r.LatencyMsV = &ms
	} else {
		message := "node unreachable or timed out"
		r.MessageV = &message
	}
	return r
}
