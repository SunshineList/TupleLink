// SPDX-License-Identifier: AGPL-3.0-only
package cmd

import (
	"encoding/json"
	"net"
	"net/http"
	"net/netip"

	"github.com/daeuniverse/dae-wing/dae"
)

// The installer and root-only network checker use this local endpoint. It
// performs no network probes and exposes no node links or credentials.
func routerReadinessHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	address, parseErr := netip.ParseAddr(host)
	if err != nil || parseErr != nil || !address.Unmap().IsLoopback() {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(dae.ReadRouterReadiness(r.URL.Query().Get("details") == "1"))
}
