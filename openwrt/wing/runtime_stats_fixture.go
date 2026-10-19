//go:build daed_runtime_test

// This fixture is excluded from release binaries. It exercises the real core
// recorders without initializing eBPF or changing host networking.
package control

import (
	"context"
	"net"
)

func NewRuntimeStatsFixture() *ControlPlane {
	return &ControlPlane{runtimeStats: newRuntimeStats()}
}

func RelayRuntimeStatsFixture(ctx context.Context, c *ControlPlane, left, right net.Conn) error {
	c.registerIncomingConnection(left)
	defer c.unregisterIncomingConnection(left)
	return RelayTCPContextWithRecords(ctx, left, right, c.runtimeDownloadRecorder(), c.runtimeUploadRecorder())
}

func EchoRuntimeUDPFixture(c *ControlPlane, conn *net.UDPConn) error {
	buf := make([]byte, 2048)
	n, from, err := conn.ReadFromUDPAddrPort(buf)
	if err != nil {
		return err
	}
	c.recordUploadTraffic(int64(n))
	return writeRuntimeTrackedUDPAddrPort(conn, buf[:n], from, c.runtimeDownloadRecorder())
}
