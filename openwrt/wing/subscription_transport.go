// SPDX-License-Identifier: AGPL-3.0-only
package subscription

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

type subscriptionProxy struct {
	mode, address, agent string
}

// The helper is supplied by the OpenWrt service, never by a GraphQL argument.
// Resolve it for each download so PassWall restarts and port changes take effect.
func readSubscriptionProxy() (subscriptionProxy, error) {
	settings := subscriptionProxy{mode: "off"}
	helper := os.Getenv("DAED_SUBSCRIPTION_PROXY_HELPER")
	if helper == "" {
		return settings, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, helper)
	cmd.WaitDelay = 100 * time.Millisecond
	output, err := cmd.Output()
	if err != nil || len(output) > 1024 {
		return settings, errors.New("subscription proxy discovery failed")
	}
	lines := strings.Split(strings.TrimSuffix(string(output), "\n"), "\n")
	switch lines[0] {
	case "off":
		return settings, nil
	case "auto", "passwall":
		settings.mode = lines[0]
	default:
		return settings, errors.New("invalid subscription proxy mode")
	}
	if len(lines) != 3 {
		return settings, errors.New("invalid subscription proxy settings")
	}
	settings.agent = lines[2]
	if !strings.HasPrefix(settings.agent, "passwall") || len(settings.agent) > 64 || strings.ContainsAny(settings.agent, "\r\n\x00") {
		return settings, errors.New("invalid subscription downloader identity")
	}
	if lines[1] == "" {
		return settings, nil
	}
	host, port, err := net.SplitHostPort(lines[1])
	if err != nil {
		return settings, errors.New("invalid local subscription proxy")
	}
	switch host {
	case "127.0.0.1", "::1":
	case "localhost":
		host = "127.0.0.1"
	default:
		return settings, errors.New("subscription proxy must listen on loopback")
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return settings, errors.New("invalid local subscription proxy port")
	}
	settings.address = net.JoinHostPort(host, strconv.Itoa(number))
	return settings, nil
}

type subscriptionHeaders struct {
	http.RoundTripper
	agent string
}

func (t subscriptionHeaders) RoundTrip(request *http.Request) (*http.Response, error) {
	request = request.Clone(request.Context())
	request.Header.Set("User-Agent", t.agent)
	request.Header.Set("Accept", "*/*")
	request.Header.Set("Accept-Encoding", "identity")
	return t.RoundTripper.RoundTrip(request)
}

func fetchLinksThroughProxy(link string, settings subscriptionProxy) ([]string, error) {
	if settings.address == "" {
		return nil, errors.New("PassWall local SOCKS proxy is unavailable; start PassWall or select another subscription download mode")
	}
	dialer, err := proxy.SOCKS5("tcp", settings.address, nil, &net.Dialer{Timeout: 4 * time.Second})
	if err != nil {
		return nil, errors.New("cannot prepare local subscription proxy")
	}
	contextDialer, ok := dialer.(proxy.ContextDialer)
	if !ok {
		return nil, errors.New("subscription proxy does not support download cancellation")
	}
	transport := &http.Transport{
		// No HTTP_PROXY/NO_PROXY override: SOCKS resolves the target hostname remotely.
		DialContext:         contextDialer.DialContext,
		TLSHandshakeTimeout: 5 * time.Second,
		DisableKeepAlives:   true,
	}
	defer transport.CloseIdleConnections()
	return _fetchLinks(link, subscriptionHeaders{transport, settings.agent}, 12*time.Second)
}

func fetchLinks(link string) ([]string, error) {
	settings, discoveryError := readSubscriptionProxy()
	if discoveryError != nil {
		return nil, discoveryError
	}
	if settings.mode == "passwall" {
		// An explicit proxy choice must not silently fall back to another exit.
		return fetchLinksThroughProxy(link, settings)
	}
	links, directError := fetchLinksDirect(link)
	if directError == nil {
		return links, nil
	}
	if settings.mode == "off" {
		return nil, directError
	}
	links, proxyError := fetchLinksThroughProxy(link, settings)
	if proxyError != nil {
		return nil, fmt.Errorf("%v; %w (PassWall SOCKS)", directError, proxyError)
	}
	return links, nil
}
