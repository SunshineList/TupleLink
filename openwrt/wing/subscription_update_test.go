// SPDX-License-Identifier: AGPL-3.0-only
package subscription

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/daeuniverse/dae-wing/db"
	"gorm.io/gorm"
)

func updateFixture(t *testing.T, link string) db.Subscription {
	t.Helper()
	t.Setenv("DAED_SUBSCRIPTION_PROXY_HELPER", "")
	if err := db.InitDatabase(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	db.SetOutput(io.Discard)
	sub := db.Subscription{Link: link}
	if err := db.DB(context.Background()).Create(&sub).Error; err != nil {
		t.Fatal(err)
	}
	return sub
}

func TestRouterSubscriptionUpdateRejectsDeletedOrEditedDownload(t *testing.T) {
	for _, remove := range []bool{false, true} {
		t.Run(map[bool]string{false: "edited", true: "deleted"}[remove], func(t *testing.T) {
			started, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(started)
				<-release
				io.WriteString(w, base64.StdEncoding.EncodeToString([]byte(fixtureNode)))
			}))
			defer srv.Close()
			defer once.Do(func() { close(release) })
			sub := updateFixture(t, srv.URL)
			done := make(chan error, 1)
			go func() { _, err := UpdateById(context.Background(), sub.ID); done <- err }()
			select {
			case <-started:
			case <-time.After(2 * time.Second):
				t.Fatal("download not started")
			}
			d := db.DB(context.Background())
			if remove {
				if err := d.Delete(&sub).Error; err != nil {
					t.Fatal(err)
				}
			} else if err := d.Model(&sub).Update("link", srv.URL+"/changed").Error; err != nil {
				t.Fatal(err)
			}
			once.Do(func() { close(release) })
			if err := <-done; err == nil {
				t.Fatal("stale response was accepted")
			}
			var count int64
			if err := d.Model(&db.Node{}).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("orphan/stale nodes: %d, %v", count, err)
			}
		})
	}
}

func TestRouterSubscriptionUpdateCancellationReachesHTTPServer(t *testing.T) {
	started, stopped := make(chan struct{}), make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done(); close(stopped) }))
	defer srv.Close()
	sub := updateFixture(t, srv.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := UpdateById(ctx, sub.ID); done <- err }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("download not started")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation lost: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("download did not stop")
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("HTTP request remained active")
	}
}

func TestRouterSubscriptionUpdateWaiterCancellationAndGateCleanup(t *testing.T) {
	unlock, err := lockSubscriptionUpdate(context.Background(), 123)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if _, err := lockSubscriptionUpdate(ctx, 123); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waiter: %v", err)
	}
	other, err := lockSubscriptionUpdate(context.Background(), 124)
	if err != nil {
		t.Fatal(err)
	}
	other()
	unlock()
	subscriptionUpdates.Lock()
	defer subscriptionUpdates.Unlock()
	if len(subscriptionUpdates.items) != 0 {
		t.Fatal("update gates leaked")
	}
}

func TestRouterSubscriptionUpdateReportsCommitFailureAndPreservesNodes(t *testing.T) {
	directFixture(t, 200)
	sub := updateFixture(t, "https://provider.invalid/fixture")
	d := db.DB(context.Background())
	// Simulate a transaction invalidated immediately before the explicit commit.
	const callback = "router:test_commit_failure"
	if err := d.Callback().Query().After("gorm:after_query").Register(callback, func(query *gorm.DB) {
		if query.Statement.Table == "systems" {
			query.Rollback()
		}
	}); err != nil {
		t.Fatal(err)
	}
	defer d.Callback().Query().Remove(callback)
	if _, err := UpdateById(context.Background(), sub.ID); err == nil {
		t.Fatal("failed commit reported as success")
	}
	var count int64
	if err := d.Model(&db.Node{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("failed transaction wrote nodes: %d, %v", count, err)
	}
}
