// SPDX-License-Identifier: AGPL-3.0-only
package subscription

import (
	"github.com/sirupsen/logrus"
	"net/url"
	"testing"
)

func TestRouterSIP008PreservesPluginName(t *testing.T) {
	for _, c := range []struct{ body, plugin string }{
		{`{"version":1,"servers":[{"server":"127.0.0.1","server_port":443,"method":"chacha20-ietf-poly1305","password":"fixture","plugin":"obfs-local","plugin_opts":"obfs=http;obfs-host=fixture.test"}]}`, "obfs-local;obfs=http;obfs-host=fixture.test"},
		{`{"version":1,"servers":[{"server":"127.0.0.1","server_port":443,"method":"aes-128-gcm","password":"fixture"}]}`, ""},
	} {
		nodes, err := ResolveSubscriptionAsSIP008(logrus.New(), []byte(c.body))
		if err != nil || len(nodes) != 1 {
			t.Fatal("SIP008 import failed", err)
		}
		u, err := url.Parse(nodes[0])
		if err != nil {
			t.Fatal(err)
		}
		if u.Query().Get("plugin") != c.plugin {
			t.Fatal("SIP003 plugin identity or options lost")
		}
	}
}
