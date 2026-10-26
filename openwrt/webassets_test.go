//go:build webassets

package main

import (
	"strings"
	"testing"
)

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

// 打包时的 web 目录必须真的进了二进制：这是「改界面只需重编网关」的前提。
func TestEmbeddedWebCarriesThePanel(t *testing.T) {
	data, encoding, err := readWebAsset("index.html")
	if err != nil {
		t.Fatalf("index.html 没嵌进来: %v", err)
	}
	// index.html 通常小于 Makefile 的 4 KiB 压缩阈值，所以允许以原文嵌入；
	// 压缩过的资源就只校验非空。
	if encoding == "" && !strings.Contains(string(data), "id=\"root\"") {
		t.Fatalf("index.html 内容不对，前 80 字节：%q", string(data[:min(80, len(data))]))
	}
	if len(data) < 100 {
		t.Fatalf("index.html 内容异常，只有 %d 字节", len(data))
	}
}
