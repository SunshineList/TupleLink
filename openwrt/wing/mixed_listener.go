// SPDX-License-Identifier: AGPL-3.0-only
package dae

import (
	"context"
	"errors"
	"net"
	"sync/atomic"
	"syscall"
)

// Runtime status comes from the owning process, never a probe of an arbitrary
// service occupying the same port. Values stored in status are immutable.
type RouterMixedStatus struct {
	Enabled   bool   `json:"enabled"`
	Address   string `json:"address"`
	Listening bool   `json:"listening"`
	CoreReady bool   `json:"core_ready"`
	Code      string `json:"code"`
}

type routerMixedRuntime struct {
	status atomic.Pointer[RouterMixedStatus]
}

var routerMixedRuntimeState routerMixedRuntime

func (r *routerMixedRuntime) publish(status RouterMixedStatus) { r.status.Store(&status) }

func (r *routerMixedRuntime) snapshot() RouterMixedStatus {
	if status := r.status.Load(); status != nil {
		return *status
	}
	return RouterMixedStatus{}
}

func (r *routerMixedRuntime) start(address, setupError string, listen func(string, string) (net.Listener, error), serve func(context.Context, net.Listener) error) (func(), error) {
	status := RouterMixedStatus{Enabled: address != "" || setupError != "", Address: address, Code: setupError}
	r.publish(status)
	noop := func() {}
	if setupError != "" {
		return noop, errors.New("mixed proxy: " + setupError)
	}
	if address == "" {
		return noop, nil
	}
	listener, err := listen("tcp", address)
	if err != nil {
		status.Code = "bind_failed"
		if errors.Is(err, syscall.EADDRINUSE) {
			status.Code = "port_in_use"
		}
		if errors.Is(err, syscall.EADDRNOTAVAIL) {
			status.Code = "lan_unavailable"
		}
		r.publish(status)
		return noop, err
	}
	status.Listening = true
	r.publish(status)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		_ = serve(ctx, listener)
		listener.Close()
		// Do not mutate the value already published to readers.
		stopped := status
		stopped.Listening = false
		stopped.Code = "listener_stopped"
		if ctx.Err() == nil {
			stopped.Code = "listener_failed"
		}
		r.status.Store(&stopped)
	}()
	return func() { cancel(); listener.Close() }, nil
}
