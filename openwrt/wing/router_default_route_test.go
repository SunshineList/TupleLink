// SPDX-License-Identifier: AGPL-3.0-only
package general

import (
	"net"
	"testing"

	"github.com/vishvananda/netlink"
)

// The kernel reports a default route with an explicit all-zero RTA_DST on
// OpenWrt, so only checking for a nil destination silently drops every default
// route and leaves the panel's WAN interface list empty.
func TestIsDefaultRoute(t *testing.T) {
	cases := []struct {
		name  string
		route netlink.Route
		want  bool
	}{
		{
			name:  "nil destination is a default route",
			route: netlink.Route{Dst: nil},
			want:  true,
		},
		{
			name:  "explicit ipv4 zero prefix is a default route",
			route: netlink.Route{Dst: &net.IPNet{IP: net.IPv4zero.To4(), Mask: net.CIDRMask(0, 32)}},
			want:  true,
		},
		{
			name:  "explicit ipv6 zero prefix is a default route",
			route: netlink.Route{Dst: &net.IPNet{IP: net.IPv6zero, Mask: net.CIDRMask(0, 128)}},
			want:  true,
		},
		{
			name:  "lan prefix is not a default route",
			route: netlink.Route{Dst: &net.IPNet{IP: net.ParseIP("192.168.5.0").To4(), Mask: net.CIDRMask(24, 32)}},
			want:  false,
		},
		{
			name:  "host route is not a default route",
			route: netlink.Route{Dst: &net.IPNet{IP: net.ParseIP("172.0.0.3").To4(), Mask: net.CIDRMask(32, 32)}},
			want:  false,
		},
		{
			name:  "prefix without a mask is not a default route",
			route: netlink.Route{Dst: &net.IPNet{IP: net.IPv4zero.To4()}},
			want:  false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := isDefaultRoute(tc.route); got != tc.want {
				t.Fatalf("isDefaultRoute() = %v, want %v", got, tc.want)
			}
		})
	}
}
