// SPDX-License-Identifier: AGPL-3.0-only
// Test-only: use dae's real asset finder, protobuf reader and routing optimizer.
// It never creates a control plane, attaches eBPF or changes network state.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/daeuniverse/dae/common/assets"
	"github.com/daeuniverse/dae/common/consts"
	"github.com/daeuniverse/dae/component/routing"
	"github.com/daeuniverse/dae/pkg/config_parser"
	"github.com/daeuniverse/dae/pkg/geodata"
	"github.com/sirupsen/logrus"
	"google.golang.org/protobuf/proto"
)

func run() error {
	consts.AppName = "daed"
	if len(os.Args) == 3 && os.Args[1] == "--fixtures" {
		directory := os.Args[2]
		if err := os.MkdirAll(directory, 0755); err != nil {
			return err
		}
		site, err := proto.Marshal(&geodata.GeoSiteList{Entry: []*geodata.GeoSite{{CountryCode: "CN", Domain: []*geodata.Domain{{Type: geodata.Domain_RootDomain, Value: "example.invalid"}}}}})
		if err != nil {
			return err
		}
		ip, err := proto.Marshal(&geodata.GeoIPList{Entry: []*geodata.GeoIP{{CountryCode: "CN", Cidr: []*geodata.CIDR{{Ip: []byte{192, 0, 2, 0}, Prefix: 24}}}}})
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(directory, "geosite.dat"), site, 0644); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(directory, "geoip.dat"), ip, 0644)
	}
	logger := logrus.New()
	logger.SetOutput(io.Discard)
	finder := assets.NewLocationFinder([]string{"/etc/daed"})
	paths := make(map[string]any)
	for _, name := range []string{"geosite.dat", "geoip.dat"} {
		path, err := finder.GetLocationAsset(logger, name)
		if err != nil {
			return err
		}
		paths[name] = path
	}
	optimizer := routing.DatReaderOptimizer{LocationFinder: finder, Logger: logger}
	rules := []*config_parser.RoutingRule{
		{AndFunctions: []*config_parser.Function{{Name: consts.Function_Domain, Params: []*config_parser.Param{{Key: "geosite", Val: "cn"}}}}},
		{AndFunctions: []*config_parser.Function{{Name: consts.Function_Ip, Params: []*config_parser.Param{{Key: "geoip", Val: "cn"}}}}},
	}
	optimized, err := optimizer.Optimize(rules)
	if err != nil {
		return err
	}
	for index, kind := range []string{"domain_rules", "ip_rules"} {
		count := len(optimized[index].AndFunctions[0].Params)
		if count == 0 {
			return fmt.Errorf("no %s were parsed", kind)
		}
		paths[kind] = count
	}
	return json.NewEncoder(os.Stdout).Encode(paths)
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
