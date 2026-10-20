// SPDX-License-Identifier: AGPL-3.0-only
package control

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"sync"
	"time"

	"github.com/daeuniverse/dae/common/netutils"
	"github.com/daeuniverse/outbound/netproxy"
	"github.com/daeuniverse/outbound/pool"
	"github.com/daeuniverse/outbound/protocol/direct"
	dnsmessage "github.com/miekg/dns"
	"github.com/olicesx/quic-go"
	"github.com/sirupsen/logrus"
)

func (c *ControlPlane) routerResolveBootstrap(ctx context.Context, host, network string, race bool,
	resolve func(context.Context, netproxy.Dialer, netip.AddrPort, string, string, bool) (*netutils.Ip46, error, error),
) (*netutils.Ip46, error, error) {
	if len(c.bootstrapResolvers) == 0 {
		err := fmt.Errorf("bootstrap resolver is not configured")
		return &netutils.Ip46{}, err, err
	}
	var first4, first6, noRecord4, noRecord6 error
	var noRecord *netutils.Ip46
	for i, resolver := range c.bootstrapResolvers {
		if err := ctx.Err(); err != nil {
			return &netutils.Ip46{}, err, err
		}
		attemptCtx := ctx
		cancel := func() {}
		// Preserve explicit single-resolver semantics. For multiple resolvers,
		// reserve time for the rest instead of handing each the entire deadline.
		if remaining := len(c.bootstrapResolvers) - i; remaining > 1 {
			budget := 1500 * time.Millisecond
			if deadline, ok := ctx.Deadline(); ok {
				if share := time.Until(deadline) / time.Duration(remaining); share < budget {
					budget = share
				}
			}
			attemptCtx, cancel = context.WithTimeout(ctx, budget)
		}
		start := time.Now()
		ip46, err4, err6 := resolve(attemptCtx, direct.SymmetricDirect, resolver, host, network, race)
		attemptErr := attemptCtx.Err()
		cancel()
		if ip46 == nil {
			ip46 = &netutils.Ip46{}
		}
		if attemptErr != nil {
			ip46, err4, err6 = &netutils.Ip46{}, attemptErr, attemptErr
		}
		probeErr := err4
		if ip46.Ip4.IsValid() || ip46.Ip6.IsValid() {
			probeErr = nil
		} else if probeErr == nil {
			probeErr = err6
		}
		c.routerLogAttempt("dns_bootstrap", i+1, start, probeErr, logrus.Fields{"attempts": len(c.bootstrapResolvers)})
		if ip46.Ip4.IsValid() || ip46.Ip6.IsValid() {
			return ip46, err4, err6
		}
		if err4 == nil || err6 == nil {
			noRecord, noRecord4, noRecord6 = ip46, err4, err6
			continue
		}
		if first4 == nil {
			first4 = err4
		}
		if first6 == nil {
			first6 = err6
		}
	}
	if noRecord != nil {
		return noRecord, noRecord4, noRecord6
	}
	if first4 == nil {
		first4 = fmt.Errorf("bootstrap resolver failed")
	}
	if first6 == nil {
		first6 = first4
	}
	return &netutils.Ip46{}, first4, first6
}

// A failed QUIC dial does not own/close the caller-supplied PacketConn. Keep
// that ownership until connection termination, including idle/remote closes.
type routerOwnedQUICConn struct {
	quic.EarlyConnection
	raw  netproxy.Conn
	once sync.Once
}

func (c *routerOwnedQUICConn) release() {
	c.once.Do(func() {
		_ = c.raw.SetDeadline(time.Now())
		_ = c.raw.Close()
	})
}

func (c *routerOwnedQUICConn) CloseWithError(code quic.ApplicationErrorCode, reason string) error {
	err := c.EarlyConnection.CloseWithError(code, reason)
	c.release()
	return err
}

func routerQUICDial(ctx context.Context, raw netproxy.Conn, packet net.PacketConn, addr net.Addr, tlsConfig *tls.Config, config *quic.Config) (quic.EarlyConnection, error) {
	conn, err := quic.DialEarly(ctx, packet, addr, tlsConfig, config)
	if err != nil {
		_ = raw.SetDeadline(time.Now())
		_ = raw.Close()
		return nil, err
	}
	owned := &routerOwnedQUICConn{EarlyConnection: conn, raw: raw}
	context.AfterFunc(conn.Context(), owned.release)
	return owned, nil
}

// Each DoQ query has its own stream, so cancellation must affect that stream
// rather than the shared QUIC connection. Close the send half after the query.
type routerDoQStream struct{ quic.Stream }

func (s routerDoQStream) Write(data []byte) (int, error) {
	n, err := s.Stream.Write(data)
	if err == nil && n == len(data) {
		err = s.Stream.Close()
	}
	return n, err
}

func (d *DoQ) routerForwardDNS(ctx context.Context, data []byte) (*dnsmessage.Msg, error) {
	if len(data) < 2 || len(data) > 65535 {
		return nil, fmt.Errorf("invalid DNS request payload length")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	connection, err := d.getOrCreateConnection(ctx)
	if err != nil {
		return nil, err
	}
	stream, err := connection.OpenStreamSync(ctx)
	if err != nil && ctx.Err() == nil {
		connection, err = d.replaceConnection(ctx, connection)
		if err == nil {
			stream, err = connection.OpenStreamSync(ctx)
		}
	}
	if err != nil {
		return nil, err
	}
	done := make(chan struct{})
	interrupt := func() { stream.CancelRead(0x3); stream.CancelWrite(0x3) }
	stop := context.AfterFunc(ctx, func() { defer close(done); interrupt() })
	defer func() {
		if !stop() {
			<-done
		}
		// Release the receive side even if a peer omitted FIN after its answer.
		stream.CancelRead(0x3)
		_ = stream.Close()
	}()
	if deadline, ok := ctx.Deadline(); ok {
		_ = stream.SetDeadline(deadline)
	}
	query := append([]byte(nil), data...)
	binary.BigEndian.PutUint16(query, 0)
	msg, err := sendStreamDNSFunc(routerDoQStream{stream}, query)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		interrupt()
		// Stream and context timers can fire in either order. Normalize the
		// expired request even if the context timer has not been scheduled yet.
		if deadline, ok := ctx.Deadline(); ok && !time.Now().Before(deadline) {
			return nil, context.DeadlineExceeded
		}
	}
	return msg, err
}

func routerForwardPipeline(ctx context.Context, data []byte, get func(context.Context) (*pipelinedConn, error)) (*dnsmessage.Msg, error) {
	var lastErr error
	for range 2 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		pc, err := get(ctx)
		if err != nil {
			return nil, err
		}
		msg, err := pc.RoundTrip(ctx, data)
		if err == nil {
			return msg, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		pc.Close()
		lastErr = err
	}
	return nil, fmt.Errorf("failed to forward DNS after retry: %w", lastErr)
}

func (pc *pipelinedConn) routerDeliver(msg *dnsmessage.Msg) {
	if msg.Id >= dnsPipelineMaxIDs {
		return
	}
	pc.routerMu.Lock()
	defer pc.routerMu.Unlock()
	if pc.routerAbandoned[msg.Id] {
		pc.routerAbandoned[msg.Id] = false
		pc.routerAbandonedCount--
		pc.idAlloc.Release(msg.Id)
		return
	}
	if slot := pc.pending[msg.Id].Swap(nil); slot != nil {
		slot.set(msg)
	}
}

func (pc *pipelinedConn) routerRoundTrip(ctx context.Context, data []byte) (*dnsmessage.Msg, error) {
	if len(data) < 2 || len(data) > 65535 {
		return nil, fmt.Errorf("invalid DNS request payload length")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Queueing for a writer is cancelable without touching the socket.
	select {
	case pc.routerWrite <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-pc.closed:
		return nil, net.ErrClosed
	}
	writeHeld := true
	defer func() {
		if writeHeld {
			<-pc.routerWrite
		}
	}()
	pc.routerMu.Lock()
	if pc.routerRetiring {
		pc.routerMu.Unlock()
		return nil, net.ErrClosed
	}
	select {
	case <-pc.closed:
		pc.routerMu.Unlock()
		return nil, net.ErrClosed
	default:
	}
	id, err := pc.idAlloc.Allocate()
	if err != nil {
		pc.routerMu.Unlock()
		return nil, err
	}
	slot := newResponseSlot()
	pc.pending[id].Store(slot)
	pc.pendingCount.Add(1)
	pc.routerMu.Unlock()
	sent := false
	defer func() {
		pc.routerMu.Lock()
		unanswered := pc.pending[id].CompareAndSwap(slot, nil)
		closed := false
		select {
		case <-pc.closed:
			closed = true
		default:
		}
		if unanswered && sent && !closed {
			// Do not reuse a canceled query's ID until its late answer arrives.
			pc.routerAbandoned[id] = true
			pc.routerAbandonedCount++
		} else {
			pc.idAlloc.Release(id)
		}
		idle := pc.pendingCount.Add(-1) == 0 && pc.routerAbandonedCount > 0
		if idle {
			pc.routerRetiring = true
		}
		pc.routerMu.Unlock()
		putResponseSlot(slot)
		// Recycle only at idle. Existing unrelated queries keep their socket.
		if idle {
			pc.Close()
		}
	}()
	buf := pool.Get(2 + len(data))
	defer pool.Put(buf)
	binary.BigEndian.PutUint16(buf, uint16(len(data)))
	copy(buf[2:], data)
	binary.BigEndian.PutUint16(buf[2:4], id)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Only an in-progress write can poison stream framing. Never apply a
	// query's read/cancel deadline to the shared reader or another writer.
	done := make(chan struct{})
	stop := context.AfterFunc(ctx, func() { defer close(done); _ = pc.conn.SetWriteDeadline(time.Now()) })
	n, err := pc.conn.Write(buf)
	if !stop() {
		<-done
	}
	_ = pc.conn.SetWriteDeadline(time.Time{})
	if err == nil && n != len(buf) {
		err = io.ErrShortWrite
	}
	if err != nil {
		pc.Close()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, err
	}
	sent = true
	<-pc.routerWrite
	writeHeld = false
	return slot.get(ctx)
}

func (pc *pipelinedConn) routerClosePending() {
	pc.routerMu.Lock()
	defer pc.routerMu.Unlock()
	pc.routerRetiring = true
	for i := range pc.pending {
		if slot := pc.pending[i].Swap(nil); slot != nil {
			slot.set(nil)
		}
		if pc.routerAbandoned[i] {
			pc.routerAbandoned[i] = false
			pc.idAlloc.Release(uint16(i))
		}
	}
	pc.routerAbandonedCount = 0
}

func routerDiagnosticResult(err error) string {
	switch {
	case err == nil:
		return "ok"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF), errors.Is(err, net.ErrClosed):
		return "closed"
	default:
		var timeout net.Error
		if errors.As(err, &timeout) && timeout.Timeout() {
			return "timeout"
		}
		return "failed"
	}
}

func routerLogAttempt(log *logrus.Logger, phase string, attempt int, start time.Time, err error, fields logrus.Fields) {
	if log == nil || !log.IsLevelEnabled(logrus.DebugLevel) {
		return
	}
	if fields == nil {
		fields = logrus.Fields{}
	}
	fields["phase"], fields["attempt"] = phase, attempt
	fields["elapsed_ms"], fields["result"] = time.Since(start).Milliseconds(), routerDiagnosticResult(err)
	// Fixed classifications only: never log URLs, passwords or raw errors here.
	log.WithFields(fields).Debug("Connection diagnostic")
}

func (c *ControlPlane) routerLogAttempt(phase string, attempt int, start time.Time, err error, fields logrus.Fields) {
	routerLogAttempt(c.log, phase, attempt, start, err, fields)
}
