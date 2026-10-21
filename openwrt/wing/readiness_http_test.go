// SPDX-License-Identifier: AGPL-3.0-only
package cmd

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRouterReadinessHTTPIsLocalAndNotCached(t *testing.T) {
	for _, test := range []struct {
		address, method string
		code            int
	}{
		{"127.0.0.1:1000", http.MethodGet, 200}, {"[::1]:1000", http.MethodGet, 200},
		{"[::ffff:127.0.0.1]:1000", http.MethodGet, 200},
		{"192.168.1.2:1000", http.MethodGet, 403}, {"bad", http.MethodGet, 403},
		{"127.0.0.1:1000", http.MethodPost, 405},
	} {
		r := httptest.NewRequest(test.method, "/health/ready?details=1", nil)
		r.RemoteAddr = test.address
		w := httptest.NewRecorder()
		routerReadinessHandler(w, r)
		if w.Code != test.code {
			t.Fatalf("%s %s: HTTP %d, want %d", test.method, test.address, w.Code, test.code)
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("readiness may be cached")
		}
		if test.code == 200 {
			var result map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if _, ok := result["phase"]; !ok {
				t.Fatal("phase missing")
			}
			if _, ok := result["ready"]; !ok {
				t.Fatal("ready missing")
			}
		}
	}
}
