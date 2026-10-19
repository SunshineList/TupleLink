// SPDX-License-Identifier: AGPL-3.0-only
package subscription

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/daeuniverse/dae-wing/db"
	"github.com/daeuniverse/dae-wing/graphql/internal"
)

func TestDetectedSubscriptionName(t *testing.T) {
	for _, test := range []struct{ title, disposition, link, want string }{
		{"base64:" + base64.StdEncoding.EncodeToString([]byte("我的机场")), `attachment; filename="fallback.yaml"`, "https://example.com/secret?token=private", "我的机场"},
		{"Plain title", "", "https://example.com", "Plain title"},
		{"base64:not-base64!", "attachment; filename*=UTF-8''%E8%AE%A2%E9%98%85.yaml", "https://example.com", "订阅"},
		{"", `inline; filename="profiles/Office.txt"`, "https://example.com", "Office"},
		{"", "", "https://example.com/private-token?key=secret#Custom%20Name", "Custom Name"},
		{"", "", "https://user:secret@example.com/private-token?key=secret", "example.com"},
		{"Test:'\x00\nName", "", "https://example.com", "Test：’Name"},
	} {
		headers := http.Header{}
		headers.Set("Profile-Title", test.title)
		headers.Set("Content-Disposition", test.disposition)
		if actual := detectedSubscriptionName(headers, test.link); actual != test.want {
			t.Errorf("got %q, want %q", actual, test.want)
		}
	}
	if got := cleanSubscriptionName(strings.Repeat("订", 100)); len([]rune(got)) != 80 {
		t.Fatal("name must be bounded")
	}
}

func TestAutomaticNameImportAndExplicitNameSurviveUpdates(t *testing.T) {
	proxyHelper(t, "off", "")
	if err := db.InitDatabase(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	db.SetOutput(io.Discard)
	title := "自动订阅"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Profile-Title", "base64:"+base64.StdEncoding.EncodeToString([]byte(title)))
		fmt.Fprint(w, base64.StdEncoding.EncodeToString([]byte(fixtureNode)))
	}))
	defer server.Close()
	d := db.DB(context.Background())
	result, err := Import(d, true, &internal.ImportArgument{Link: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	if result.Sub.Subscription.Tag == nil || *result.Sub.Subscription.Tag != "自动订阅" {
		t.Fatal("missing detected name")
	}
	manual := "My own label"
	custom, err := Import(d, true, &internal.ImportArgument{Link: server.URL, Tag: &manual})
	if err != nil {
		t.Fatal(err)
	}
	title = "Changed provider title"
	updated, err := UpdateById(context.Background(), custom.Sub.Subscription.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Tag == nil || *updated.Tag != manual {
		t.Fatal("update replaced user label")
	}
	autoUpdated, err := UpdateById(context.Background(), result.Sub.Subscription.ID)
	if err != nil {
		t.Fatal(err)
	}
	if autoUpdated.Tag == nil || *autoUpdated.Tag != "自动订阅" {
		t.Fatal("update replaced existing automatic name")
	}

}

func TestAutomaticNameThroughProxy(t *testing.T) {
	directFixture(t, 403)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Profile-Title", "Proxy title")
		fmt.Fprint(w, base64.StdEncoding.EncodeToString([]byte(fixtureNode)))
	}))
	defer server.Close()
	address, _ := socksFixture(t, strings.TrimPrefix(server.URL, "http://"))
	proxyHelper(t, "auto", address)
	if err := db.InitDatabase(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	db.SetOutput(io.Discard)
	result, err := Import(db.DB(context.Background()), true, &internal.ImportArgument{Link: "http://subscription.invalid/private-token"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Sub.Subscription.Tag == nil || *result.Sub.Subscription.Tag != "Proxy title" {
		t.Fatal("SOCKS download lost name metadata")
	}
}
