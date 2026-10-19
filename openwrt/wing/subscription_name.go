// SPDX-License-Identifier: AGPL-3.0-only
package subscription

import (
	"encoding/base64"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

func cleanSubscriptionName(value string) string {
	if !utf8.ValidString(value) || len(value) > 4096 {
		return ""
	}
	value = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		if r == ':' {
			return '：'
		}
		if r == '\'' {
			return '’'
		}
		return r
	}, value)
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > 80 {
		value = string(runes[:80])
	}
	return value
}

// Names come from the successful subscription response, with no extra request.
// URL paths and query strings can contain credentials, so fallback uses host only.
func detectedSubscriptionName(headers http.Header, link string) string {
	title := strings.TrimSpace(headers.Get("Profile-Title"))
	if strings.HasPrefix(strings.ToLower(title), "base64:") {
		encoded := title[len("base64:"):]
		title = ""
		if len(encoded) <= 4096 {
			for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
				if decoded, err := encoding.DecodeString(encoded); err == nil {
					title = string(decoded)
					break
				}
			}
		}
	}
	if name := cleanSubscriptionName(title); name != "" {
		return name
	}
	if _, params, err := mime.ParseMediaType(headers.Get("Content-Disposition")); err == nil {
		filename := path.Base(strings.ReplaceAll(params["filename"], "\\", "/"))
		for _, extension := range []string{".yaml", ".yml", ".json", ".txt"} {
			if strings.HasSuffix(strings.ToLower(filename), extension) {
				filename = filename[:len(filename)-len(extension)]
				break
			}
		}
		if filename != "." {
			if name := cleanSubscriptionName(filename); name != "" {
				return name
			}
		}
	}
	if parsed, err := url.Parse(link); err == nil {
		if name := cleanSubscriptionName(parsed.Fragment); name != "" {
			return name
		}
		if name := cleanSubscriptionName(parsed.Hostname()); name != "" {
			return name
		}
	}
	return "Subscription"
}
