#!/usr/bin/env python3
"""Apply the reviewed router backend additions to the pinned wing working copy.

The Git submodule revision is unchanged. Sources live here in the parent repo
and are included in the release source archive. Unknown local edits are refused.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

HERE = Path(__file__).resolve().parent
ORIGINAL = "ae8c0126a163fce0d7c1abea226579c69c9784f65e1e7f95bd1a8e903d450779"


def prepare(root):
    target = root / "graphql/service/subscription"
    source = target / "mutation_utils.go"
    text = source.read_text(encoding="utf-8")
    manifest = root / ".daed-openwrt-prepare.json"
    previous = json.loads(manifest.read_text()) if manifest.exists() else {}
    digest = lambda value: hashlib.sha256(value).hexdigest()
    marker = "// OpenWrt subscription transport: prepared by openwrt/prepare-wing.py.\n"
    if text.startswith(marker):
        if previous.get("mutation_utils.go") != digest(text.encode()):
            raise ValueError("Prepared wing source was edited; refusing to overwrite it")
    else:
        if hashlib.sha256(text.encode()).hexdigest() != ORIGINAL:
            raise ValueError("Pinned wing subscription source differs; review before applying router additions")
        text = text.replace('"net/http"', '"net/http"\n\t"net/http/cookiejar"\n\t"net/url"\n\t"encoding/json"')
        text = text.replace("func fetchLinks(", "func fetchLinksDirect(", 1)
        text = text.replace("c := http.Client{", "jar, _ := cookiejar.New(nil)\n\tc := http.Client{\n\t\tJar: jar,", 1)
        text = text.replace('if err != nil {\n\t\treturn nil, err\n\t}\n\treq.Header.Set', 'if err != nil {\n\t\treturn nil, fmt.Errorf("invalid subscription URL")\n\t}\n\treq.Header.Set', 1)
        text = text.replace('resp, err = c.Do(req)\n\tif err != nil {\n\t\treturn nil, err\n\t}', '''resp, err = c.Do(req)
	if err != nil {
		// net/http wraps errors with the complete credential-bearing URL.
		var urlError *url.Error
		if errors.As(err, &urlError) {
			if errors.Is(urlError.Err, dae.ErrControlPlaneNotInit) { return nil, dae.ErrControlPlaneNotInit }
			return nil, fmt.Errorf("subscription connection, redirect or TLS verification failed")
		}
		return nil, err
	}
	defer resp.Body.Close()''', 1)
        text = text.replace('return nil, fmt.Errorf("failed to fetch link: %v", resp.Status)', '''// Only identify the known code; never return the provider's free-form body.
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var failure struct { Code string `json:"code"` }
		if json.Unmarshal(body, &failure) == nil && failure.Code == "AUTH_FAIL" {
			return nil, fmt.Errorf("subscription HTTP %d AUTH_FAIL: the subscription provider rejected this download exit", resp.StatusCode)
		}
		return nil, fmt.Errorf("subscription HTTP %d", resp.StatusCode)''', 1)
        text = text.replace('\n\tdefer resp.Body.Close()\n\tb, err = io.ReadAll(resp.Body)', '\n\tb, err = io.ReadAll(io.LimitReader(resp.Body, (4<<20)+1))', 1)
        text = text.replace('\n\t// Resolve node links.', '\n\tif len(b) > 4<<20 { return nil, fmt.Errorf("subscription response exceeds 4 MiB") }\n\n\t// Resolve node links.', 1)
        text = marker + text
        source.write_text(text, encoding="utf-8", newline="\n")
    generated = {"mutation_utils.go": digest(text.encode())}
    for name in ("subscription_transport.go", "subscription_transport_test.go"):
        destination = target / name
        data = (HERE / "wing" / name).read_bytes()
        if destination.exists() and destination.read_bytes() != data and previous.get(name) != digest(destination.read_bytes()):
            raise ValueError("Refusing to overwrite different backend addition: " + name)
        shutil.copyfile(HERE / "wing" / name, destination)
        generated[name] = digest(data)
    manifest.write_text(json.dumps(generated, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wing", type=Path)
    args = parser.parse_args()
    prepare(args.wing.resolve(strict=True))
    print("Router subscription transport prepared; pinned submodule revision unchanged")
