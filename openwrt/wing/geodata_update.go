// SPDX-License-Identifier: AGPL-3.0-only
package dae

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sync/atomic"
)

type RouterGeodataTransaction struct{ Target, Previous string }

var routerGeodataRoot atomic.Value
var routerGeodataName = regexp.MustCompile(`^data-[0-9]+$`)

func routerSetGeodataRoot(dirs []string) {
	root := ""
	if len(dirs) > 0 {
		if absolute, err := filepath.Abs(dirs[0]); err == nil {
			root = filepath.Join(absolute, "geodata")
		}
	}
	routerGeodataRoot.Store(root)
}

// Called only by the serialized control-plane reload loop. Roll back the
// files BEFORE the existing control-plane fallback tries to read old rules.
func routerBeginGeodata(tx *RouterGeodataTransaction) (func() error, error) {
	root, _ := routerGeodataRoot.Load().(string)
	if root == "" || tx == nil || !routerGeodataName.MatchString(tx.Target) || (tx.Previous != "" && !routerGeodataName.MatchString(tx.Previous)) {
		return nil, errors.New("invalid geodata transaction")
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("unsafe geodata directory")
	}
	for _, name := range []string{tx.Target, tx.Previous} {
		if name == "" {
			continue
		}
		directory := filepath.Join(root, name)
		info, err = os.Lstat(directory)
		if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
			return nil, errors.New("unsafe geodata batch")
		}
		for _, asset := range []string{"geoip.dat", "geosite.dat"} {
			info, err = os.Lstat(filepath.Join(directory, asset))
			if err != nil || !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > 64<<20 {
				return nil, errors.New("incomplete geodata batch")
			}
		}
	}
	current := filepath.Join(root, "current")
	previous, err := os.Readlink(current)
	if os.IsNotExist(err) {
		previous = ""
	} else if err != nil {
		return nil, errors.New("unsafe geodata pointer")
	}
	if previous != tx.Previous {
		return nil, errors.New("stale geodata transaction")
	}
	point := func(target string) error {
		if target == "" {
			return os.Remove(current)
		}
		file, err := os.CreateTemp(root, ".current-*")
		if err != nil {
			return err
		}
		name := file.Name()
		file.Close()
		os.Remove(name)
		defer os.Remove(name)
		if err = os.Symlink(target, name); err != nil {
			return err
		}
		if err = os.Rename(name, current); err != nil {
			return err
		}
		dir, err := os.Open(root)
		if err != nil {
			return err
		}
		defer dir.Close()
		return dir.Sync()
	}
	if err = point(tx.Target); err != nil {
		_ = point(tx.Previous)
		return nil, err
	}
	rollback := func() error {
		value, err := os.Readlink(current)
		if err != nil {
			return err
		}
		if value == tx.Previous {
			return nil
		}
		if value != tx.Target {
			return errors.New("geodata changed during rollback")
		}
		return point(tx.Previous)
	}
	return rollback, nil
}

func ActivateRouterGeodata(ctx context.Context, target, previous string) error {
	if !routerGeodataName.MatchString(target) || (previous != "" && !routerGeodataName.MatchString(previous)) {
		return errors.New("invalid geodata batch")
	}
	callback := make(chan error, 1)
	message := &ReloadMessage{Callback: callback, Geodata: &RouterGeodataTransaction{target, previous}}
	select {
	case ChReloadConfigs <- message:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case err := <-callback:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}
