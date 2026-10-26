//go:build webassets

package main

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// 面板前端在打包时嵌进网关，而不是只存在 daed 里。
// 这样改界面只需要重编这一个 20MB 的二进制，不必重建带 eBPF 的 daed。
//
//go:embed web
var webFiles embed.FS

var webRoot, webRootErr = fs.Sub(webFiles, "web")

func readWebAsset(name string) ([]byte, string, error) {
	if webRootErr != nil {
		return nil, "", webRootErr
	}
	// 构建时同一个路径可能只留了 .gz：Makefile 规则是「压缩后更小才留压缩件」。
	if !strings.HasSuffix(name, ".gz") {
		if data, err := fs.ReadFile(webRoot, name+".gz"); err == nil {
			return data, "gzip", nil
		}
	}
	data, err := fs.ReadFile(webRoot, name)
	return data, "", err
}

func contentTypeOf(name string) string {
	if value := mime.TypeByExtension(path.Ext(name)); value != "" {
		return value
	}
	switch path.Ext(name) {
	case ".js":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json", ".webmanifest":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".webp":
		return "image/webp"
	}
	return "application/octet-stream"
}

// serveWebAsset 只接管静态文件；读不到就返回 false，交回上游 daed 兜底。
func serveWebAsset(w http.ResponseWriter, r *http.Request, requestPath string) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	if !isStaticPath(requestPath) {
		return false
	}
	name := strings.TrimPrefix(requestPath, "/")
	if name == "" {
		name = "index.html"
	}
	data, encoding, err := readWebAsset(name)
	if err != nil {
		return false
	}
	header := w.Header()
	if encoding != "" {
		header.Set("Content-Encoding", encoding)
	}
	header.Set("Content-Type", contentTypeOf(name))
	header.Set("X-Content-Type-Options", "nosniff")
	// 带指纹的资源可以长期缓存；HTML 每次都要重新校验，否则更新面板后
	// 浏览器会一直用旧的 index.html 去加载已经删掉的旧 chunk。
	if fingerprintedAsset.MatchString(name) {
		header.Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		header.Set("Cache-Control", "no-store")
	}
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(data)
	}
	return true
}
