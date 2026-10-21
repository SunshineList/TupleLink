// SPDX-License-Identifier: AGPL-3.0-only
package control

import (
	"strings"
	"time"

	"github.com/daeuniverse/dae/common/consts"
	"github.com/daeuniverse/dae/component/outbound/dialer"
	dnsmessage "github.com/miekg/dns"
)

// SnapshotRestartDNS is called before this generation is closed. Only fresh
// address answers are retained: a client can still be using these cached IPs.
// Bitmaps are deliberately not exported; startup recomputes them from the
// current routing rules through the existing reload-cache replay path.
func (c *ControlPlane) SnapshotRestartDNS(limit int, now time.Time) map[string]*DnsCache {
	result := make(map[string]*DnsCache)
	if c == nil || limit <= 0 {
		return result
	}
	controller := c.ActiveDnsController()
	if controller == nil || controller.dnsControllerStore == nil {
		return result
	}
	controller.dnsCache.Range(func(key, value any) bool {
		name, ok := key.(string)
		cache, valid := value.(*DnsCache)
		if !ok || !valid || cache == nil || !cache.Deadline.After(now) || !cache.OriginalDeadline.After(now) {
			return true
		}
		hasAddress := false
		for _, answer := range cache.Answer {
			switch answer.(type) {
			case *dnsmessage.A, *dnsmessage.AAAA:
				hasAddress = true
			}
		}
		if hasAddress {
			result[name] = cache.CloneForReload()
		}
		return len(result) < limit
	})
	return result
}

type RouterGroupCandidate struct {
	Name    string `json:"name"`
	Policy  string `json:"policy"`
	Members int    `json:"members"`
	IPv4    string `json:"candidate_ipv4,omitempty"`
	IPv6    string `json:"candidate_ipv6,omitempty"`
}

type RouterDataplaneStatus struct {
	Initialized  bool                   `json:"initialized"`
	DNSReady     bool                   `json:"dns_ready"`
	RoutingReady bool                   `json:"routing_ready"`
	Groups       []RouterGroupCandidate `json:"groups,omitempty"`
}

func routerDiagnosticLabel(value string) string {
	if strings.Contains(value, "://") {
		return "[redacted]"
	}
	text := []rune(value)
	if len(text) > 80 {
		text = text[:80]
	}
	return string(text)
}

// The caller holds the wing lifecycle read lock, so Close cannot release this
// generation during the snapshot. This performs no probes or policy changes.
func (c *ControlPlane) RouterDataplaneStatus(details bool) RouterDataplaneStatus {
	var result RouterDataplaneStatus
	if c == nil || c.ctx == nil || c.ctx.Err() != nil {
		return result
	}
	select {
	case <-c.ready:
		result.Initialized = true
	default:
	}
	select {
	case <-c.dnsUpstreamAvailable:
		result.DNSReady = true
	default:
	}
	controller := c.ActiveDnsController()
	result.RoutingReady = controller != nil && controller.dnsControllerStore != nil && !controller.routerReplayFailed.Load()
	if !details {
		return result
	}
	for index, group := range c.outbounds {
		if index < int(consts.OutboundUserDefinedMin) || group == nil {
			continue
		}
		entry := RouterGroupCandidate{Name: routerDiagnosticLabel(group.Name), Policy: string(group.GetSelectionPolicy()), Members: len(group.Dialers)}
		// Random policies have no stable current candidate. Do not advance their
		// PRNG or represent a diagnostic selection as the site's actual exit.
		if group.GetSelectionPolicy() != consts.DialerSelectionPolicy_Random {
			for _, family := range []consts.IpVersionStr{consts.IpVersionStr_4, consts.IpVersionStr_6} {
				selected, _, err := group.Select(&dialer.NetworkType{L4Proto: consts.L4ProtoStr_TCP, IpVersion: family}, true)
				if err != nil || selected == nil || selected.Property() == nil {
					continue
				}
				name := routerDiagnosticLabel(selected.Property().Name)
				if family == consts.IpVersionStr_4 {
					entry.IPv4 = name
				} else {
					entry.IPv6 = name
				}
			}
		}
		result.Groups = append(result.Groups, entry)
		if len(result.Groups) == 64 {
			break
		}
	}
	return result
}

// Restore must finish binding all cached addresses before this generation is
// published. The normal nonblocking queue can drop updates under load, and a
// browser using its own cached IP will not necessarily issue another DNS query.
func (c *DnsController) routerRestoreRouting(cache *DnsCache, now time.Time) {
	if rt := c.runtime(); rt != nil && rt.cacheAccessCallback != nil {
		if err := rt.cacheAccessCallback(cache); err != nil {
			c.routerReplayFailed.Store(true)
			if c.log != nil {
				c.log.WithError(err).WithField("phase", "dns_route_restore").Warn("DNS routing association could not be restored")
			}
		} else {
			cache.MarkBpfUpdated(now)
		}
	}
}
