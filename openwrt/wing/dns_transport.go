// SPDX-License-Identifier: AGPL-3.0-only
package control

import (
	"context"
	"net"
	"time"
)

// Some encrypted streams serialize Close behind a read lock. Interrupt the
// read before closing so HTTP/TLS cancellation cannot wait for server data.
type routerDNSStreamConn struct{ net.Conn }

func (c *routerDNSStreamConn) Close() error {
	_ = c.Conn.SetDeadline(time.Now())
	return c.Conn.Close()
}

// Serialize only connection creation, leaving established pipelines concurrent.
// A burst of first-page queries should share a socket, not all dial and discard.
func (p *connPool) routerGet(ctx context.Context) (*pipelinedConn, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.mu.RLock()
	if p.closed {
		p.mu.RUnlock()
		return nil, net.ErrClosed
	}
	if len(p.conns) > 0 {
		conn := p.conns[p.index.Add(1)%uint32(len(p.conns))]
		select {
		case <-conn.closed:
		default:
			if len(p.conns) >= p.maxConns || conn.pendingCount.Load() < connPoolScaleUpPendingThreshold {
				p.mu.RUnlock()
				return conn, nil
			}
		}
	}
	p.mu.RUnlock()
	select {
	case p.dialGate <- struct{}{}:
		defer func() { <-p.dialGate }()
	case <-p.done:
		return nil, net.ErrClosed
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil, net.ErrClosed
	}
	p.pruneClosedLocked()
	if len(p.conns) > 0 {
		conn := p.conns[p.index.Add(1)%uint32(len(p.conns))]
		if len(p.conns) >= p.maxConns || conn.pendingCount.Load() < connPoolScaleUpPendingThreshold {
			p.mu.Unlock()
			return conn, nil
		}
	}
	p.mu.Unlock()
	raw, err := p.dialer(ctx)
	if err != nil {
		if raw != nil {
			_ = raw.SetDeadline(time.Now())
			_ = raw.Close()
		}
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		_ = raw.SetDeadline(time.Now())
		_ = raw.Close()
		return nil, err
	}
	conn := newPipelinedConn(raw)
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		conn.Close()
		return nil, net.ErrClosed
	}
	p.conns = append(p.conns, conn)
	p.mu.Unlock()
	return conn, nil
}

func (p *connPool) routerClose() error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	close(p.done)
	conns := p.conns
	p.conns = nil
	p.mu.Unlock()
	// Socket cleanup must not hold the pool mutex while interrupting I/O.
	for _, conn := range conns {
		conn.Close()
	}
	return nil
}

// Wait for an already-running callback before a borrowed socket can be reused.
// This prevents a late cancellation from setting a deadline on the next query.
func routerDNSInterruptOnCancel(ctx context.Context, conn interface{ SetDeadline(time.Time) error }) func() {
	done := make(chan struct{})
	stop := context.AfterFunc(ctx, func() { defer close(done); _ = conn.SetDeadline(time.Now()) })
	return func() {
		if !stop() {
			<-done
		}
	}
}
