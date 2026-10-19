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
    # Carry successful-response metadata only for a new import; updates keep names.
    text = text.replace("func fetchLinksDirect(subscriptionLink string)", "func fetchLinksDirect(subscriptionLink string, names ...*string)")
    text = text.replace("timeout/2)", "timeout/2, names...)")
    text = text.replace("transport http.RoundTripper, timeout time.Duration)", "transport http.RoundTripper, timeout time.Duration, names ...*string)")
    begin, end = text.index("func _fetchLinks("), text.index("func Import(")
    fetch = text[begin:end]
    if "detectedSubscriptionName(resp.Header" not in fetch:
        fetch = fetch.replace("\treturn links, nil", "\tif len(names) > 0 && names[0] != nil { *names[0] = detectedSubscriptionName(resp.Header, subscriptionLink) }\n\treturn links, nil", 1)
        text = text[:begin] + fetch + text[end:]
    text = text.replace("links, err := fetchLinks(argument.Link)", "var detectedName string\n\tlinks, err := fetchLinks(argument.Link, &detectedName)")
    if "argument.Tag = &detectedName" not in text:
        text = text.replace("\t/// Create a subscription model.", '\tif argument.Tag == nil && detectedName != "" { argument.Tag = &detectedName }\n\t/// Create a subscription model.')
    begin, end = text.index("func UpdateById("), text.index("\nfunc Remove(")
    text = text[:begin] + '''func UpdateById(ctx context.Context, subId uint) (*db.Subscription, error) {
    return updateSubscriptionSafely(ctx, subId)
}
''' + text[end:]
    text = text.replace('func fetchLinksDirect(subscriptionLink string, names ...*string) (links []string, err error) {', '''func fetchLinksDirect(subscriptionLink string, names ...*string) ([]string, error) {
    return fetchLinksDirectContext(context.Background(), subscriptionLink, names...)
}

func fetchLinksDirectContext(ctx context.Context, subscriptionLink string, names ...*string) (links []string, err error) {''')
    text = text.replace('_fetchLinks(subscriptionLink,', '_fetchLinksContext(ctx, subscriptionLink,')
    text = text.replace('func _fetchLinks(subscriptionLink string, transport http.RoundTripper, timeout time.Duration, names ...*string) (links []string, err error) {', '''func _fetchLinks(subscriptionLink string, transport http.RoundTripper, timeout time.Duration, names ...*string) ([]string, error) {
    return _fetchLinksContext(context.Background(), subscriptionLink, transport, timeout, names...)
}

func _fetchLinksContext(ctx context.Context, subscriptionLink string, transport http.RoundTripper, timeout time.Duration, names ...*string) (links []string, err error) {''')
    text = text.replace('http.NewRequest("GET", subscriptionLink, nil)', 'http.NewRequestWithContext(ctx, "GET", subscriptionLink, nil)')
    text = text.replace('// Retry with dae routing.', 'if ctx.Err() != nil { return nil, ctx.Err() }\n\t\t// Retry with dae routing.') if 'if ctx.Err() != nil' not in text else text
    text = text.replace('links, err := fetchLinks(argument.Link, &detectedName)', 'links, err := fetchLinksContext(c.Statement.Context, argument.Link, &detectedName)')
    source.write_text(text, encoding="utf-8", newline="\n")
    generated = {"mutation_utils.go": digest(text.encode())}
    for name in ("subscription_transport.go", "subscription_transport_test.go", "subscription_name.go", "subscription_name_test.go", "subscription_update.go", "subscription_update_test.go"):
        destination = target / name
        data = (HERE / "wing" / name).read_bytes()
        if destination.exists() and destination.read_bytes() != data and previous.get(name) != digest(destination.read_bytes()):
            raise ValueError("Refusing to overwrite different backend addition: " + name)
        shutil.copyfile(HERE / "wing" / name, destination)
        generated[name] = digest(data)
    # Keep latency fixes in the release source, without changing submodule pins.
    patches = {
        "dae-core/component/outbound/dialer/dialer.go": ("c6615ddf375371b1974c6d35ef8660aea8ee907fe88ebe09207560b5da5d39ad", lambda value: value.replace('return &netproxy.FakeNetConn{\n\t\t\t\t\tConn:  conn,\n\t\t\t\t\tLAddr: nil,\n\t\t\t\t\tRAddr: nil,\n\t\t\t\t}, nil', 'return routerCheckConn(conn), nil', 1)),
        "dae-core/component/outbound/dialer/register.go": ("59aa07ff1a3bf7c7dd38353091c3e9cdb2510f256e02e327c1fc768ef4e3ca99", lambda value: value.replace('normalizedLink := normalizeShadowTLSPluginOptions(link)\n\tbaseDialer := newDefaultNetworkDialer(direct.SymmetricDirect, gOption.SoMarkFromDae, gOption.Mptcp)', 'normalizedLink, baseDialer, err := routerProtocolOptions(normalizeShadowTLSPluginOptions(link), newDefaultNetworkDialer(direct.SymmetricDirect, gOption.SoMarkFromDae, gOption.Mptcp), gOption.UDPHopInterval)\n\tif err != nil { return nil, err }', 1)),
        "dae-core/common/subscription/subscription.go": ("c48c3a14937aac13fde5d10af24e6d5774c6b5d2f09f8f23872201c06dcdd05f", lambda value: value.replace('url.Values{"plugin": []string{server.PluginOpts}}.Encode()', 'routerSIP008Plugin(server.Plugin, server.PluginOpts)', 1)),
        "dae/runtime.go": ("582676a55373d44220dced8552f094482d7d35a423d13de98ae0865cbe687062", lambda value: (HERE / "wing/runtime.go").read_text(encoding="utf-8")),
        "graphql/service/node/latency_mutation_utils.go": ("b7e722f4c24dd9606fceaf310daf285b30b8d878413ca20702970ef3b4ca805d", lambda value: (HERE / "wing/node_latency.go").read_text(encoding="utf-8")),
        "graphql/service/node/latency_cache.go": ("4d4fd03249c617bcc9fccb508dbc2d567fa74557dd5900ee046cbf307ff64831", lambda value: value.replace('if err := refreshLatencyCacheIfNeeded(ctx); err != nil {\n\t\treturn nil, err\n\t}', '// Reading results must never start network probes.').replace('if _, ok := merged[id]; !ok {', 'if cached, ok := merged[id]; !ok || resolver.TestedAtV.After(cached.TestedAtV) {')),
        "graphql/mutation.go": ("90a8f23ac625f2d3adf79f7f236d40b6529e2857028cc5ed02f02c0e111ee8ef", lambda value: value.replace('TestNodeLatencies(args *struct', 'TestNodeLatencies(ctx context.Context, args *struct').replace('node.TestLatencies(context.TODO(), args.IDs)', 'node.TestLatencies(ctx, args.IDs)')),
    }
    for relative, (original, transform) in patches.items():
        destination = root / relative
        data = destination.read_bytes()
        if digest(data) == original:
            data = transform(data.decode()).encode()
        elif previous.get(relative) != digest(data):
            raise ValueError("Unknown backend source; refusing to overwrite: " + relative)
        elif relative in ("graphql/service/node/latency_mutation_utils.go", "dae/runtime.go"):
            replacement = "node_latency.go" if relative.endswith("latency_mutation_utils.go") else "runtime.go"
            data = (HERE / "wing" / replacement).read_bytes()
        destination.write_bytes(data)
        generated[relative] = digest(data)
    mutation_file = root / "graphql/mutation.go"
    mutation_text = mutation_file.read_text(encoding="utf-8")
    mutation_text = mutation_text.replace('ImportSubscription(args *struct', 'ImportSubscription(ctx context.Context, args *struct')
    begin, end = mutation_text.index('func (r *MutationResolver) ImportSubscription('), mutation_text.index('func (r *MutationResolver) UpdateSubscriptionLink(')
    subscription_mutations = mutation_text[begin:end].replace('db.BeginTx(context.TODO())', 'db.BeginTx(ctx)')
    subscription_mutations = subscription_mutations.replace('\ttx.Commit()', '\tif err := tx.Commit().Error; err != nil { return nil, err }')
    subscription_mutations = subscription_mutations.replace('ctx, cancel := context.WithTimeout(', 'schedulerCtx, cancel := context.WithTimeout(').replace('subscription.UpdateAll(ctx)', 'subscription.UpdateAll(schedulerCtx)')
    subscription_mutations = subscription_mutations.replace('UpdateSubscription(args *struct', 'UpdateSubscription(ctx context.Context, args *struct').replace('subscription.Update(context.TODO(), args.ID)', 'subscription.Update(ctx, args.ID)')
    mutation_text = mutation_text[:begin] + subscription_mutations + mutation_text[end:]
    mutation_file.write_text(mutation_text, encoding="utf-8", newline="\n")
    generated["graphql/mutation.go"] = digest(mutation_text.encode())
    destination = root / "graphql/service/node/router_latency_test.go"
    key = "graphql/service/node/router_latency_test.go"
    data = (HERE / "wing/node_latency_test.go").read_bytes()
    if destination.exists() and destination.read_bytes() != data and previous.get(key) != digest(destination.read_bytes()):
        raise ValueError("Unknown latency tests; refusing to overwrite")
    destination.write_bytes(data)
    generated[key] = digest(data)
    for relative, source in (
        ("graphql/service/node/router_latency_cache.go", "node_latency_cache.go"),
        ("graphql/service/node/router_latency_cache_test.go", "node_latency_cache_test.go"),
        ("dae-core/component/outbound/dialer/router_protocol_compat.go", "protocol_compat.go"),
        ("dae-core/component/outbound/dialer/router_protocol_compat_test.go", "protocol_compat_test.go"),
        ("dae-core/common/subscription/router_sip008.go", "sip008.go"),
        ("dae-core/common/subscription/router_sip008_test.go", "sip008_test.go"),
        ("graphql/service/node/router_protocol_interop_test.go", "protocol_interop_test.go"),
    ):
        destination = root / relative
        data = (HERE / "wing" / source).read_bytes()
        if destination.exists() and destination.read_bytes() != data and previous.get(relative) != digest(destination.read_bytes()):
            raise ValueError("Unknown protocol compatibility source: " + relative)
        destination.write_bytes(data)
        generated[relative] = digest(data)
    cache_file = root / "graphql/service/node/latency_cache.go"
    cache_text = cache_file.read_text(encoding="utf-8")
    cache_text = cache_text.replace('// Reading results must never start network probes.', '// Reading results must never start network probes.\n\tbefore := latencyCacheEntriesBeforeQuery(ids)') if 'before := latencyCacheEntriesBeforeQuery(ids)' not in cache_text else cache_text
    cache_text = cache_text.replace('merged := snapshotCachedLatencyResults()', 'merged := latencyCacheForNodes(nodes, ids == nil, before)')
    cache_file.write_text(cache_text, encoding="utf-8", newline="\n")
    generated["graphql/service/node/latency_cache.go"] = digest(cache_text.encode())
    # Tagged socket fixtures validate the real per-plane recorders and adapter.
    # They are not compiled into release binaries and never initialize eBPF.
    for relative, source in (
        ("dae/router_runtime_test.go", "runtime_test.go"),
        ("dae-core/control/router_runtime_fixture.go", "runtime_stats_fixture.go"),
    ):
        destination = root / relative
        data = (HERE / "wing" / source).read_bytes()
        if destination.exists() and destination.read_bytes() != data and previous.get(relative) != digest(destination.read_bytes()):
            raise ValueError("Unknown runtime test fixture; refusing to overwrite: " + relative)
        destination.write_bytes(data)
        generated[relative] = digest(data)
    manifest.write_text(json.dumps(generated, indent=2) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wing", type=Path)
    args = parser.parse_args()
    prepare(args.wing.resolve(strict=True))
    print("Router backend additions prepared; pinned submodule revisions unchanged")
