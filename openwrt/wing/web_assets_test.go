// SPDX-License-Identifier: AGPL-3.0-only
package webrender

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	"github.com/vearutop/statigz"
)

type observedAssets struct {
	fstest.MapFS
	mu    sync.Mutex
	opens map[string]int
}

func (f *observedAssets) Open(name string) (fs.File, error) {
	f.mu.Lock()
	f.opens[name]++
	f.mu.Unlock()
	return f.MapFS.Open(name)
}

func TestRouterAssetsDoNotReadUnusedEditorFiles(t *testing.T) {
	files := &observedAssets{MapFS: fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("panel")}, "assets/app.js": &fstest.MapFile{Data: []byte("script")}}, opens: make(map[string]int)}
	for i := range 100 {
		files.MapFS[fmt.Sprintf("assets/unused-language-%d.js", i)] = &fstest.MapFile{Data: bytes.Repeat([]byte("unused"), 1024)}
	}
	h := routerFileServer(files)
	if len(files.opens) != 0 {
		t.Fatal("server construction read embedded data")
	}
	for _, name := range []string{"/", "/assets/app.js"} {
		response := httptest.NewRecorder()
		h.ServeHTTP(response, httptest.NewRequest("GET", name, nil))
		if response.Code != 200 {
			t.Fatalf("%s: %d", name, response.Code)
		}
	}
	for name := range files.opens {
		if strings.Contains(name, "unused-language") {
			t.Fatalf("unused asset read: %s", name)
		}
	}
}

func TestRouterAssetsPreserveHTTPResponses(t *testing.T) {
	var compressed bytes.Buffer
	w := gzip.NewWriter(&compressed)
	w.Write([]byte("compressed script"))
	w.Close()
	files := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("panel")}, "assets/plain.js": &fstest.MapFile{Data: []byte("plain script")}, "assets/encoded.js.gz": &fstest.MapFile{Data: compressed.Bytes()}}
	fallback := statigz.OnNotFound(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("SPA fallback"))
	})
	old, current := statigz.FileServer(files, fallback), routerFileServer(files, fallback)
	for _, target := range []string{"/", "/index.html?x=1", "/assets", "/assets/", "/assets/plain.js", "/assets/encoded.js", "/resources", "/missing.js", "/../outside"} {
		for _, encoding := range []string{"", "gzip"} {
			for _, method := range []string{"GET", "HEAD"} {
				t.Run(method+target+encoding, func(t *testing.T) {
					request := httptest.NewRequest(method, target, nil)
					request.Header.Set("Accept-Encoding", encoding)
					a, b := httptest.NewRecorder(), httptest.NewRecorder()
					old.ServeHTTP(a, request)
					current.ServeHTTP(b, request)
					if a.Code != b.Code || !bytes.Equal(a.Body.Bytes(), b.Body.Bytes()) {
						t.Fatalf("response differs: old=%d %q, new=%d %q", a.Code, a.Body.String(), b.Code, b.Body.String())
					}
					for _, header := range []string{"Content-Type", "Content-Encoding", "Content-Length", "Vary", "ETag", "Location"} {
						if a.Header().Get(header) != b.Header().Get(header) {
							t.Fatalf("%s differs: %q vs %q", header, a.Header().Get(header), b.Header().Get(header))
						}
					}
				})
			}
		}
	}
	for _, headers := range []map[string]string{{"Range": "bytes=1-4"}, {"If-None-Match": responseETag(old)}} {
		request := httptest.NewRequest("GET", "/assets/plain.js", nil)
		for k, v := range headers {
			request.Header.Set(k, v)
		}
		a, b := httptest.NewRecorder(), httptest.NewRecorder()
		old.ServeHTTP(a, request)
		current.ServeHTTP(b, request)
		if a.Code != b.Code || !bytes.Equal(a.Body.Bytes(), b.Body.Bytes()) {
			t.Fatal("range/conditional response changed")
		}
	}
}

func responseETag(h http.Handler) string {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/assets/plain.js", nil))
	return w.Header().Get("ETag")
}

func TestRouterAssetIndexIsBoundedAndSafeUnderConcurrency(t *testing.T) {
	files := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("panel")}}
	for i := range routerAssetIndexLimit * 3 {
		files[fmt.Sprintf("assets/%d.js", i)] = &fstest.MapFile{Data: []byte("script")}
	}
	h := routerFileServer(files).(*routerAssets)
	var wg sync.WaitGroup
	for i := range routerAssetIndexLimit * 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", fmt.Sprintf("/assets/%d.js", i), nil))
		}()
	}
	wg.Wait()
	if len(h.entries) != routerAssetIndexLimit || h.lru.Len() != routerAssetIndexLimit {
		t.Fatal("asset index exceeded limit")
	}
	for i := range 100 {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", fmt.Sprintf("/unknown-%d", i), nil))
	}
	if len(h.entries) > routerAssetIndexLimit {
		t.Fatal("unknown routes grew asset index")
	}
}
