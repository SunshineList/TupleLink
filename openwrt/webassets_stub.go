//go:build !webassets

package main

import "net/http"

// 没有带 webassets 构建标记时（例如只跑单元测试），静态资源仍由 daed 提供。
func serveWebAsset(_ http.ResponseWriter, _ *http.Request, _ string) bool {
	return false
}
