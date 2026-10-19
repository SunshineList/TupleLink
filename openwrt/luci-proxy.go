// SPDX-License-Identifier: AGPL-3.0-only
// The CGI gateway delegates access to LuCI and keeps Daed credentials on-device.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/cgi"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/daeuniverse/dae-wing/db"
	"github.com/golang-jwt/jwt/v5"
)

const gatewayPath = "/cgi-bin/daed-router/"
const sessionCookie = "daed_luci_session"
const credentialName = "luci-session.json"

var validSession = regexp.MustCompile(`^[a-fA-F0-9]{32}$`)

type credentials struct {
	Username string `json:"username"`
	Secret   string `json:"secret"`
}

// Run once with the service stopped. Existing users and their per-user defaults
// are reused, so upgrading does not reset selected configurations or accounts.
func prepare(configDir string) error {
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return err
	}
	if err := db.InitDatabase(configDir); err != nil {
		return err
	}
	var users []db.User
	if err := db.DB(context.Background()).Order("id").Limit(1).Find(&users).Error; err != nil {
		return err
	}
	var user db.User
	if len(users) > 0 {
		user = users[0]
	} else {
		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return err
		}
		user = db.User{Username: "luci", PasswordHash: "!", JwtSecret: hex.EncodeToString(secret), JsonStorage: "{}"}
		if err := db.DB(context.Background()).Create(&user).Error; err != nil {
			return errors.New("cannot create local LuCI identity")
		}
	}
	if user.Username == "" || user.JwtSecret == "" {
		return errors.New("invalid local identity")
	}
	data, err := json.Marshal(credentials{user.Username, user.JwtSecret})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(configDir, ".luci-session-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(configDir, credentialName))
}

func readCredentials(configDir string) (credentials, error) {
	var value credentials
	name := filepath.Join(configDir, credentialName)
	info, err := os.Lstat(name)
	if err != nil {
		return value, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return value, errors.New("local credentials are not private")
	}
	data, err := os.ReadFile(name)
	if err != nil {
		return value, err
	}
	err = json.Unmarshal(data, &value)
	if value.Username == "" || value.Secret == "" {
		return value, errors.New("local credentials are incomplete")
	}
	return value, err
}

func sessionAccess(ctx context.Context, session string) bool {
	if !validSession.MatchString(session) || session == strings.Repeat("0", 32) {
		return false
	}
	input, _ := json.Marshal(map[string]string{"ubus_rpc_session": session, "scope": "access-group", "object": "luci-app-daed-router", "function": "write"})
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "ubus", "call", "session", "access", string(input)).Output()
	var response struct {
		Access bool `json:"access"`
	}
	return err == nil && json.Unmarshal(data, &response) == nil && response.Access
}

func backendURL() (*url.URL, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "uci", "-q", "get", "daed.main.listen_port").Output()
	port := "2023"
	if err == nil {
		port = strings.TrimSpace(string(data))
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return nil, errors.New("invalid local management port")
	}
	return url.Parse("http://127.0.0.1:" + strconv.Itoa(number))
}

func sameOrigin(r *http.Request) bool {
	scheme := r.URL.Scheme
	if scheme == "" {
		scheme = "http"
		if r.TLS != nil {
			scheme = "https"
		}
	}
	return r.Header.Get("Origin") == scheme+"://"+r.Host
}

func gateway(configDir string, target *url.URL, access func(context.Context, string) bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", 405)
			return
		}
		if r.Method == http.MethodPost && !sameOrigin(r) {
			http.Error(w, "Origin rejected", 403)
			return
		}
		if r.URL.Path == strings.TrimSuffix(gatewayPath, "/") {
			http.Redirect(w, r, gatewayPath, 307)
			return
		}
		if !strings.HasPrefix(r.URL.Path, gatewayPath) {
			http.NotFound(w, r)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, gatewayPath)
		if path == "session" {
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", 405)
				return
			}
			var input struct {
				Session string `json:"session"`
			}
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&input) != nil || !access(r.Context(), input.Session) {
				http.Error(w, "LuCI session expired or access denied", 401)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: input.Session, Path: gatewayPath, HttpOnly: true, Secure: r.URL.Scheme == "https" || r.TLS != nil, SameSite: http.SameSiteStrictMode})
			w.WriteHeader(204)
			return
		}
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || !access(r.Context(), cookie.Value) {
			http.Error(w, "LuCI 登录已失效，请刷新路由器后台。", 401)
			return
		}
		if path == "graphql" && r.Method != http.MethodPost {
			http.Error(w, "GraphQL requires POST", 405)
			return
		}
		if path != "graphql" && r.Method == http.MethodPost {
			http.Error(w, "Method not allowed", 405)
			return
		}
		if r.ContentLength > 8<<20 {
			http.Error(w, "Request too large", 413)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		identity, err := readCredentials(configDir)
		if err != nil {
			http.Error(w, "Daed 尚未就绪，请重新启动服务。", 503)
			return
		}
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": identity.Username, "role": "admin", "exp": time.Now().Add(time.Minute).Unix()}).SignedString([]byte(identity.Secret))
		if err != nil {
			http.Error(w, "Local authorization failed", 503)
			return
		}
		proxy := httputil.NewSingleHostReverseProxy(target)
		proxy.Director = func(request *http.Request) {
			request.URL.Scheme, request.URL.Host = target.Scheme, target.Host
			request.URL.Path, request.URL.RawPath = "/"+path, ""
			request.Host = target.Host
			request.Header.Del("Cookie")
			request.Header.Del("Origin")
			request.Header.Del("X-Forwarded-Host")
			request.Header.Del("X-Forwarded-Proto")
			request.Header.Set("Authorization", "Bearer "+token)
		}
		proxy.ModifyResponse = func(response *http.Response) error {
			response.Header.Set("Cache-Control", "no-store")
			response.Header.Del("Set-Cookie")
			response.Header.Del("Access-Control-Allow-Origin")
			return nil
		}
		proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "Daed 服务暂时不可用，请重试或查看运行日志。", 502)
		}
		proxy.Transport = &http.Transport{Proxy: nil, ResponseHeaderTimeout: 30 * time.Second, DisableKeepAlives: true}
		proxy.ServeHTTP(w, r)
	})
}

func main() {
	configDir := flag.String("config", "/etc/daed", "Daed configuration directory")
	initialize := flag.Bool("prepare", false, "Prepare local identity before starting Daed")
	flag.Parse()
	if *initialize {
		if err := prepare(*configDir); err != nil {
			fmt.Fprintln(os.Stderr, "Cannot prepare LuCI access:", err)
			os.Exit(1)
		}
		return
	}
	target, err := backendURL()
	if err == nil {
		err = cgi.Serve(gateway(*configDir, target, sessionAccess))
	}
	if err != nil {
		io.WriteString(os.Stdout, "Status: 503 Service Unavailable\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nDaed 服务尚未就绪。\n")
	}
}
