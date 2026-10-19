// SPDX-License-Identifier: AGPL-3.0-only
package dialer

import (
	proxyurl "github.com/daeuniverse/outbound/common/url"
	"github.com/daeuniverse/outbound/protocol/direct"
	"testing"
)

func TestRouterProtocolURIOptions(t *testing.T) {
	for _, c := range []struct {
		link, host, insecure string
		obfs, invalid        bool
	}{
		{"anytls://fixture@127.0.0.1:443?insecure=true&sni=fixture.test", "127.0.0.1:443", "1", false, false},
		{"anytls://fixture@127.0.0.1:443?allowInsecure=true", "127.0.0.1:443", "1", false, false},
		{"anytls://fixture@127.0.0.1:443?insecure=false&allowInsecure=true", "127.0.0.1:443", "0", false, false},
		{"anytls://fixture@127.0.0.1:443", "127.0.0.1:443", "", false, false},
		{"hy2://fixture@[::1]:443?mport=5000-5001,5010&obfs=salamander&obfsPassword=fixture", "[::1]:5000", "", true, false},
		{"hy2://fixture@127.0.0.1:443?ports=5001-5000", "", "", false, true},
		{"hy2://fixture@127.0.0.1:443?ports=0", "", "", false, true},
		{"hy2://fixture@127.0.0.1:443?obfs=unknown", "", "", false, true},
		{"hy2://fixture@127.0.0.1:443?obfs=salamander", "", "", false, true},
	} {
		link, next, err := routerProtocolOptions(c.link, direct.SymmetricDirect, 0)
		if c.invalid {
			if err == nil {
				t.Fatal("invalid options were silently accepted")
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		u, err := proxyurl.Parse(link)
		if err != nil {
			t.Fatal(err)
		}
		if u.Host != c.host || u.Query().Get("insecure") != c.insecure {
			t.Fatal("protocol URI parameters changed incorrectly")
		}
		if hop, ok := next.(*routerHopDialer); ok {
			next = hop.next
		}
		_, wrapped := next.(*routerSalamanderDialer)
		if wrapped != c.obfs {
			t.Fatal("obfuscation transport not applied")
		}
		if u.User.Username() != "fixture" {
			t.Fatal("authentication changed")
		}
	}
}
