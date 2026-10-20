// SPDX-License-Identifier: AGPL-3.0-only
package component

import (
	"context"
	"io"
	"testing"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/vishvananda/netlink"
	"golang.org/x/sys/unix"
)

func routerTestInterfaceManager(t *testing.T, callbacks []callbackSet, existing bool) (chan netlink.LinkUpdate, <-chan struct{}, *InterfaceManager) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	log := logrus.New()
	log.SetOutput(io.Discard)
	m := &InterfaceManager{log: log, closed: ctx, close: cancel, callbacks: callbacks, upLinks: make(map[string]bool)}
	if existing {
		m.upLinks["test0"] = true
	}
	updates, done := make(chan netlink.LinkUpdate, 8), make(chan struct{})
	go m.monitor(updates, done)
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Error("interface monitor did not stop")
		}
	})
	return updates, done, m
}

func routerLinkEvent(kind uint16, index int) netlink.LinkUpdate {
	return netlink.LinkUpdate{Header: unix.NlMsghdr{Type: kind}, Link: &netlink.Dummy{LinkAttrs: netlink.LinkAttrs{Name: "test0", Index: index}}}
}

func routerExpectCallbacks(t *testing.T, got <-chan string, expected ...string) {
	t.Helper()
	for _, want := range expected {
		select {
		case value := <-got:
			if value != want {
				t.Fatalf("callback = %s, want %s", value, want)
			}
		case <-time.After(time.Second):
			t.Fatalf("missing callback %s", want)
		}
	}
}

func TestRouterInterfaceKeepsAllMatchingCallbacks(t *testing.T) {
	got := make(chan string, 4)
	updates, _, _ := routerTestInterfaceManager(t, []callbackSet{
		{pattern: "test*", newCallback: func(netlink.Link) { got <- "first" }},
		{pattern: "test0", newCallback: func(netlink.Link) { got <- "second" }},
	}, false)
	updates <- routerLinkEvent(unix.RTM_NEWLINK, 7)
	routerExpectCallbacks(t, got, "first", "second")
}

func TestRouterInterfaceKeepsRapidDeleteAndRecreateInOrder(t *testing.T) {
	got := make(chan string, 4)
	updates, _, _ := routerTestInterfaceManager(t, []callbackSet{{pattern: "test0",
		delCallback: func(link netlink.Link) {
			if link.Attrs().Index == 7 {
				got <- "delete-old"
			}
		},
		newCallback: func(link netlink.Link) {
			if link.Attrs().Index == 8 {
				got <- "bind-new"
			}
		},
	}}, true)
	updates <- routerLinkEvent(unix.RTM_DELLINK, 7)
	updates <- routerLinkEvent(unix.RTM_NEWLINK, 8)
	routerExpectCallbacks(t, got, "delete-old", "bind-new")
}

func TestRouterInterfaceIgnoresDuplicateStatusNotifications(t *testing.T) {
	got := make(chan string, 4)
	updates, _, _ := routerTestInterfaceManager(t, []callbackSet{{pattern: "test0",
		newCallback: func(netlink.Link) { got <- "bind" },
		delCallback: func(netlink.Link) { got <- "delete" },
	}}, false)
	updates <- routerLinkEvent(unix.RTM_NEWLINK, 7)
	updates <- routerLinkEvent(unix.RTM_NEWLINK, 7)
	updates <- routerLinkEvent(unix.RTM_DELLINK, 7)
	routerExpectCallbacks(t, got, "bind", "delete")
}

func TestRouterInterfaceCloseUnblocksQueuedLifecycleEvents(t *testing.T) {
	started, release := make(chan struct{}, 1), make(chan struct{})
	defer close(release)
	updates, done, manager := routerTestInterfaceManager(t, []callbackSet{{pattern: "test0",
		newCallback: func(netlink.Link) {
			select {
			case started <- struct{}{}:
			default:
			}
			<-release
		},
	}}, false)
	updates <- routerLinkEvent(unix.RTM_NEWLINK, 7)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("callback did not start")
	}
	go func() {
		for i := 0; i < 400; i++ {
			for _, kind := range []uint16{unix.RTM_DELLINK, unix.RTM_NEWLINK} {
				select {
				case updates <- routerLinkEvent(kind, 7):
				case <-done:
					return
				}
			}
		}
	}()
	// Fill the monitor's small input queue while the first callback is blocked.
	deadline := time.After(time.Second)
	for len(updates) != cap(updates) {
		select {
		case <-deadline:
			t.Fatal("input queue did not fill")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	manager.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("close blocked behind callback backpressure")
	}
}
