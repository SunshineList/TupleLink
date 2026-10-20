// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2023, daeuniverse Organization <team@v2raya.org>
package webrender

import (
	"container/list"
	"io/fs"
	"net/http"
	"path"
	"sort"
	"strings"
	"sync"

	"github.com/vearutop/statigz"
)

const routerAssetIndexLimit = 64

// statigz normally hashes the entire embedded tree on startup. On a router this
// faults even unused editors/languages into resident memory. Give it only the
// requested file (and its compressed representation), retaining its HTTP logic.
func routerFileServer(root fs.ReadDirFS, options ...func(*statigz.Server)) http.Handler {
	return &routerAssets{root: root, options: options, entries: make(map[string]*list.Element)}
}

type routerAsset struct {
	name string
	http.Handler
}

type routerAssets struct {
	root    fs.ReadDirFS
	options []func(*statigz.Server)
	mu      sync.Mutex
	entries map[string]*list.Element
	lru     list.List
}

func (s *routerAssets) cached(name string) http.Handler {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry := s.entries[name]; entry != nil {
		s.lru.MoveToFront(entry)
		return entry.Value.(routerAsset).Handler
	}
	return nil
}

func (s *routerAssets) handler(name string) http.Handler {
	if h := s.cached(name); h != nil {
		return h
	}
	files := &routerAssetFS{root: s.root, directory: path.Dir(name), files: make(map[string]fs.DirEntry)}
	for _, candidate := range []string{name, name + ".gz"} {
		info, err := fs.Stat(s.root, candidate)
		if err == nil && !info.IsDir() {
			files.files[path.Base(candidate)] = fs.FileInfoToDirEntry(info)
		}
	}
	if len(files.files) == 0 {
		return nil
	}
	h := statigz.FileServer(files, s.options...)
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry := s.entries[name]; entry != nil {
		s.lru.MoveToFront(entry)
		return entry.Value.(routerAsset).Handler
	}
	s.entries[name] = s.lru.PushFront(routerAsset{name: name, Handler: h})
	if len(s.entries) > routerAssetIndexLimit {
		last := s.lru.Back()
		delete(s.entries, last.Value.(routerAsset).name)
		s.lru.Remove(last)
	}
	return h
}

func (s *routerAssets) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodGet && req.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(req.URL.Path, "/")
	if name == "" || strings.HasSuffix(name, "/") {
		name += "index.html"
	}
	var h http.Handler
	if fs.ValidPath(name) {
		h = s.handler(name)
	}
	if h == nil {
		if fs.ValidPath(name) {
			if info, err := fs.Stat(s.root, name); err == nil && info.IsDir() {
				target := path.Base(req.URL.Path) + "/"
				if req.URL.RawQuery != "" {
					target += "?" + req.URL.RawQuery
				}
				w.Header().Set("Location", target)
				w.WriteHeader(http.StatusMovedPermanently)
				return
			}
		}
		// Preserve the existing SPA fallback without indexing other files.
		h = s.handler("index.html")
		if h == nil {
			http.NotFound(w, req)
			return
		}
		h.ServeHTTP(w, req)
		return
	}
	copy := req.Clone(req.Context())
	copy.URL.Path = "/" + path.Base(name)
	if req.URL.Path == "/" {
		copy.URL.Path = "/"
	}
	h.ServeHTTP(w, copy)
}

// This virtual flat directory exposes only one asset and its gzip variant.
// Opening files delegates to embed.FS without copying their bytes to the heap.
type routerAssetFS struct {
	root      fs.ReadDirFS
	directory string
	files     map[string]fs.DirEntry
}

func (f *routerAssetFS) Open(name string) (fs.File, error) {
	if _, ok := f.files[name]; !ok {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
	return f.root.Open(path.Join(f.directory, name))
}

func (f *routerAssetFS) ReadDir(name string) ([]fs.DirEntry, error) {
	if name != "." {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
	}
	var entries []fs.DirEntry
	for _, entry := range f.files {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	return entries, nil
}
