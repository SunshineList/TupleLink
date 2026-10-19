// SPDX-License-Identifier: AGPL-3.0-only
package dae

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/daeuniverse/dae/cmd"
	"github.com/sirupsen/logrus"
)

// External check sites can be blocked even when the local network is usable.
// Never prevent loading cached nodes and DNS/routing indefinitely: the core's
// own health checks continue recovering after the router or uplink comes back.
func routerWaitForNetwork(log *logrus.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	transport := &http.Transport{
		DialContext:         (&net.Dialer{Timeout: 2 * time.Second}).DialContext,
		TLSHandshakeTimeout: 2 * time.Second,
		DisableKeepAlives:   true,
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	if err := waitForRouterNetwork(ctx, client, cmd.CheckNetworkLinks, 250*time.Millisecond); err != nil {
		log.Warn("Network readiness check timed out; loading saved configuration and continuing background health checks")
	}
}

func waitForRouterNetwork(ctx context.Context, client *http.Client, links []string, retry time.Duration) error {
	if len(links) == 0 {
		return errors.New("no network readiness targets")
	}
	for attempt := 0; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, links[attempt%len(links)], nil)
		if err != nil {
			return errors.New("invalid network readiness target")
		}
		response, err := client.Do(request)
		if err == nil {
			response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 500 {
				return nil
			}
		}
		timer := time.NewTimer(retry)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
