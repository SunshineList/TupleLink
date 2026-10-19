// SPDX-License-Identifier: AGPL-3.0-only
package cmd

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/daeuniverse/dae-wing/db"
	"github.com/golang-jwt/jwt/v5"
)

func TestRouterAuthPreservesRequestContext(t *testing.T) {
	type key struct{}
	ctx, cancel := context.WithTimeout(context.WithValue(context.Background(), key{}, "request"), time.Second)
	defer cancel()
	request := httptest.NewRequest(http.MethodPost, "/graphql", nil).WithContext(ctx)
	auth(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		if r.Context().Value(key{}) != "request" {
			t.Error("authentication discarded request-scoped state")
		}
		if _, ok := r.Context().Deadline(); !ok {
			t.Error("authentication discarded the request deadline")
		}
		cancel()
		if r.Context().Err() != context.Canceled {
			t.Error("authentication detached request cancellation")
		}
	})).ServeHTTP(httptest.NewRecorder(), request)
}

func TestRouterAuthCancelsWorkAfterClientDisconnect(t *testing.T) {
	started, stopped, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(auth(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(started)
		select {
		case <-r.Context().Done():
			close(stopped)
		case <-release:
		}
	})))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, server.URL, nil)
	done := make(chan struct{})
	go func() {
		defer close(done)
		if response, err := server.Client().Do(request); err == nil {
			response.Body.Close()
		}
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("request did not reach the server")
	}
	cancel()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("disconnected client left backend work running")
	}
	<-done
}

func TestRouterAuthRejectsTokenWithoutExpiry(t *testing.T) {
	if err := db.InitDatabase(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	db.SetOutput(io.Discard)
	user := db.User{Username: "router-auth-test", JwtSecret: "local-fixture-secret"}
	if err := db.DB(context.Background()).Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	for _, valid := range []bool{false, true} {
		claims := jwt.MapClaims{"sub": user.Username, "role": "admin"}
		if valid {
			claims["exp"] = time.Now().Add(time.Minute).Unix()
		}
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(user.JwtSecret))
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		request.Header.Set("Authorization", "Bearer "+token)
		auth(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			if authenticated := r.Context().Value("user") != nil; authenticated != valid {
				t.Errorf("authenticated=%v for valid=%v", authenticated, valid)
			}
		})).ServeHTTP(httptest.NewRecorder(), request)
	}
}
