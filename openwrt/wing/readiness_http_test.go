// SPDX-License-Identifier: AGPL-3.0-only
package cmd

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
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
		require.Equal(t, test.code, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		if test.code == 200 {
			var result map[string]any
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
			require.Contains(t, result, "phase")
			require.Contains(t, result, "ready")
		}
	}
}
