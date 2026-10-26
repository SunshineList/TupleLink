package main

import "testing"

func TestIsStaticPathOnlyClaimsBuildOutput(t *testing.T) {
	static := []string{"", "/", "/index.html", "/favicon.ico", "/logo.webp", "/assets/index-BxMPL5Ql.js", "/assets/index-L9yh9e_i.css", "/assets/editor.worker-DQJwLooG.js"}
	for _, item := range static {
		if !isStaticPath(item) {
			t.Fatalf("%s 应该被本地静态处理接管", item)
		}
	}
	// 这些必须继续走反向代理，否则面板拿不到数据或绕过鉴权边界。
	proxy := []string{"/graphql", "/session", "/assets/", "/assets/notfingerprinted.js", "/manifest.json", "/admin", "/../etc/passwd"}
	for _, item := range proxy {
		if isStaticPath(item) {
			t.Fatalf("%s 不应该被本地静态处理接管", item)
		}
	}
}

func TestContentTypeOfCoversBuildOutput(t *testing.T) {
	cases := map[string]string{
		"assets/index-BxMPL5Ql.js":  "text/javascript; charset=utf-8",
		"assets/index-L9yh9e_i.css": "text/css; charset=utf-8",
		"index.html":                "text/html; charset=utf-8",
		"logo.webp":                 "image/webp",
		"favicon.ico":               "image/vnd.microsoft.icon",
	}
	for name, want := range cases {
		if got := contentTypeOf(name); got != want {
			t.Fatalf("%s: 期望 %q，得到 %q", name, want, got)
		}
	}
}
