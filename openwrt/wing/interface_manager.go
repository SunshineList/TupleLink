/*
*  SPDX-License-Identifier: AGPL-3.0-only
*  Copyright (c) 2022-2025, daeuniverse Organization <dae@v2raya.org>
 */

package component

import (
	"context"
	"path"
	"sync"

	"github.com/sirupsen/logrus"
	"github.com/vishvananda/netlink"
	"golang.org/x/sys/unix"
)

type callbackSet struct {
	pattern     string
	newCallback func(netlink.Link)
	delCallback func(netlink.Link)
}

type InterfaceManager struct {
	log       *logrus.Logger
	closed    context.Context
	close     context.CancelFunc
	mu        sync.Mutex
	callbacks []callbackSet
	upLinks   map[string]bool
}

func NewInterfaceManager(log *logrus.Logger) *InterfaceManager {
	closed, toClose := context.WithCancel(context.Background())
	mgr := &InterfaceManager{
		log:       log,
		callbacks: make([]callbackSet, 0),
		closed:    closed,
		close:     toClose,
		upLinks:   make(map[string]bool),
	}

	ch := make(chan netlink.LinkUpdate)
	done := make(chan struct{})
	if e := netlink.LinkSubscribeWithOptions(ch, done, netlink.LinkSubscribeOptions{
		ErrorCallback: func(err error) {
			select {
			case <-closed.Done():
				return
			default:
				log.Debug("LinkSubscribe:", err)
			}
		},
		ListExisting: true,
	}); e != nil {
		log.Errorf("Failed to subscribe to link updates: %v", e)
	}

	go mgr.monitor(ch, done)
	return mgr
}

type job struct {
	ifName string
	fn     func()
}

func (m *InterfaceManager) monitor(ch <-chan netlink.LinkUpdate, done chan struct{}) {
	defer close(done)
	defer m.close()
	jobChan := make(chan job, 128)
	defer close(jobChan)
	go func() {
		queues := make(map[string]chan func())
		for {
			select {
			case <-m.closed.Done():
				return
			case j, ok := <-jobChan:
				if !ok {
					return
				}
				queue := queues[j.ifName]
				if queue == nil {
					queue = make(chan func(), 32)
					queues[j.ifName] = queue
					go func(q <-chan func()) {
						for {
							select {
							case <-m.closed.Done():
								return
							case callback := <-q:
								if m.closed.Err() != nil {
									return
								}
								callback()
							}
						}
					}(queue)
				}
				// Keep every lifecycle callback in order. Debouncing by interface
				// name loses delete/recreate pairs and overlapping registrations.
				select {
				case queue <- j.fn:
				case <-m.closed.Done():
					return
				}
			}
		}
	}()
	for {
		select {
		case <-m.closed.Done():
			return
		case update, ok := <-ch:
			if !ok {
				return
			}
			if update.Link == nil || update.Link.Attrs() == nil {
				continue
			}
			ifName := update.Link.Attrs().Name
			m.mu.Lock()
			var callbacks []job
			switch update.Header.Type {
			case unix.RTM_NEWLINK:
				if m.upLinks[ifName] {
					m.mu.Unlock()
					continue
				}
				m.upLinks[ifName] = true
			case unix.RTM_DELLINK:
				delete(m.upLinks, ifName)
			default:
				m.mu.Unlock()
				continue
			}
			for _, callback := range m.callbacks {
				matched, err := path.Match(callback.pattern, ifName)
				if err != nil || !matched {
					continue
				}
				cb := callback.newCallback
				if update.Header.Type == unix.RTM_DELLINK {
					cb = callback.delCallback
				}
				if cb != nil {
					link := update.Link
					callbacks = append(callbacks, job{ifName: ifName, fn: func() { cb(link) }})
				}
			}
			m.mu.Unlock()
			for _, callback := range callbacks {
				select {
				case jobChan <- callback:
				case <-m.closed.Done():
					return
				}
			}
		}
	}
}

func (m *InterfaceManager) RegisterWithPattern(pattern string, initCallback func(netlink.Link), newCallback func(netlink.Link), delCallback func(netlink.Link)) {
	m.mu.Lock()
	defer m.mu.Unlock()

	links, err := netlink.LinkList()
	if err == nil {
		for _, link := range links {
			ifName := link.Attrs().Name
			if matched, err := path.Match(pattern, ifName); err == nil && matched {
				m.upLinks[ifName] = true

				if initCallback != nil {
					link := link
					go initCallback(link)
				}
			}
		}
	} else {
		m.log.Errorf("Failed to get link list: %v", err)
	}

	m.callbacks = append(m.callbacks, callbackSet{
		pattern:     pattern,
		newCallback: newCallback,
		delCallback: delCallback,
	})
}

func (m *InterfaceManager) Register(ifname string, initCallback func(netlink.Link), newCallback func(netlink.Link), delCallback func(netlink.Link)) {
	m.mu.Lock()
	defer m.mu.Unlock()

	link, err := netlink.LinkByName(ifname)
	if err == nil {
		m.upLinks[ifname] = true

		if initCallback != nil {
			go initCallback(link)
		}
	}

	m.callbacks = append(m.callbacks, callbackSet{
		pattern:     ifname,
		newCallback: newCallback,
		delCallback: delCallback,
	})
}

// Close cancels the context to stop the monitor goroutine
func (m *InterfaceManager) Close() error {
	m.close()
	return nil
}
