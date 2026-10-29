// SPDX-License-Identifier: AGPL-3.0-only
package dae

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"os"
	"strconv"
	"time"

	"github.com/daeuniverse/dae/common/consts"
	"github.com/daeuniverse/dae/control"
)

func routerStartMixedProxy() (func(), error) {
	return routerMixedRuntimeState.start(os.Getenv("DAED_MIXED_LISTEN"), os.Getenv("DAED_MIXED_ERROR"), net.Listen,
		func(ctx context.Context, listener net.Listener) error {
			return control.ServeMixed(ctx, listener, routerMixedDial)
		})
}

func routerMixedDial(ctx context.Context, target, source string) (control.MixedConn, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	host, portText, err := net.SplitHostPort(target)
	if err != nil {
		return nil, err
	}
	port, err := strconv.ParseUint(portText, 10, 16)
	if err != nil || port == 0 {
		return nil, errors.New("invalid mixed proxy target port")
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	src, err := netip.ParseAddrPort(source)
	if err != nil {
		return nil, err
	}
	// Prevent a control plane from closing during route selection and dialing.
	routerLifecycleMu.RLock()
	defer routerLifecycleMu.RUnlock()
	plane := currentControlPlane.Load()
	if plane == nil || plane != routerServingPlane {
		return nil, errors.New("proxy core not ready")
	}
	domain := host
	if _, err := netip.ParseAddr(host); err == nil {
		domain = ""
	}
	var lastErr error
	for _, ip := range ips {
		conn, err := plane.RouteDialTcpContext(ctx, &control.RouteDialParam{
			Outbound: consts.OutboundControlPlaneRouting, Domain: domain,
			Src: netip.AddrPortFrom(src.Addr().Unmap(), src.Port()), Dest: netip.AddrPortFrom(ip.Unmap(), uint16(port)),
		})
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("no target addresses")
	}
	return nil, lastErr
}
