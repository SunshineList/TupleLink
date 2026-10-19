// SPDX-License-Identifier: AGPL-3.0-only
package subscription

import "net/url"

func routerSIP008Plugin(name, options string) string {
	q := url.Values{}
	if name != "" {
		if options != "" {
			name += ";" + options
		}
		q.Set("plugin", name)
	}
	return q.Encode()
}
