package wealthsimple

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func accountNode(id string, amount any, currency string) map[string]any {
	return map[string]any{
		"id": id, "nickname": "My account", "unifiedAccountType": "TFSA", "currency": "CAD",
		"financials": map[string]any{"currentCombined": map[string]any{
			"netLiquidationValueV2": map[string]any{"amount": amount, "currency": currency},
		}},
	}
}

func accountResponse(nodes []any, next bool, cursor any) map[string]any {
	edges := make([]any, 0, len(nodes))
	for _, node := range nodes {
		edges = append(edges, map[string]any{"node": node})
	}
	return map[string]any{"data": map[string]any{"identity": map[string]any{"netWorth": map[string]any{"accounts": map[string]any{
		"edges": edges, "pageInfo": map[string]any{"hasNextPage": next, "endCursor": cursor},
	}}}}}
}

func fixture(t *testing.T, overrides map[string]http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if override := overrides[r.URL.Path]; override != nil {
			override(w, r)
			return
		}
		switch r.URL.Path {
		case "/login":
			http.SetCookie(w, &http.Cookie{Name: "wssdi", Value: "device-fixture", Path: "/"})
			fmt.Fprint(w, `<html><script type="module" src="/assets/app-fixture.js"></script></html>`)
		case "/assets/app-fixture.js":
			fmt.Fprint(w, `const configuration={environment:"production",clientId:"public-client"};`)
		case "/token":
			writeJSON(w, map[string]string{"access_token": "access-1", "refresh_token": "refresh-1"})
		case "/token/info":
			writeJSON(w, map[string]string{"identity_canonical_id": "identity-1"})
		case "/graphql":
			writeJSON(w, accountResponse([]any{accountNode("account-1", "100.25", "CAD")}, false, nil))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	c, err := NewClient(Options{HTTPClient: srv.Client(), LoginURL: srv.URL + "/login", TokenURL: srv.URL + "/token", GraphQLURL: srv.URL + "/graphql"})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func login(t *testing.T, c *Client) {
	t.Helper()
	if err := c.Login(context.Background(), "person@example.test", "password-fixture", ""); err != nil {
		t.Fatal(err)
	}
}

func TestLoginAndReadWithoutFinancialCache(t *testing.T) {
	var loginCalls, reads atomic.Int32
	c := fixture(t, map[string]http.HandlerFunc{
		"/token": func(w http.ResponseWriter, r *http.Request) {
			loginCalls.Add(1)
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
			}
			if payload["grant_type"] != "password" || payload["scope"] != "invest.read trade.read tax.read" || payload["username"] != "person@example.test" {
				t.Errorf("incorrect login fields")
			}
			if r.Header.Get("Authorization") != "" || r.Header.Get("x-ws-device-id") != "device-fixture" || r.Header.Get("x-ws-session-id") == "" {
				t.Error("incorrect authentication headers")
			}
			writeJSON(w, map[string]string{"access_token": "access-1", "refresh_token": "refresh-1"})
		},
		"/graphql": func(w http.ResponseWriter, r *http.Request) {
			var payload struct {
				Query         string
				OperationName string
				Variables     map[string]any
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
			}
			if payload.OperationName != "FinSightAccounts" || payload.Variables["identityId"] != "identity-1" || !strings.Contains(payload.Query, "query FinSightAccounts") || strings.Contains(payload.Query, "mutation") {
				t.Error("incorrect account operation")
			}
			if r.Header.Get("Authorization") != "Bearer access-1" || r.Header.Get("x-ws-api-version") != "12" {
				t.Error("missing provider headers")
			}
			writeJSON(w, accountResponse([]any{accountNode("account-1", fmt.Sprintf("%d.00", reads.Add(1)), "CAD")}, false, nil))
		},
	})
	if _, err := c.Accounts(context.Background()); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("before login: %v", err)
	}
	if loginCalls.Load() != 0 || reads.Load() != 0 {
		t.Fatal("constructor or disconnected read contacted provider")
	}
	login(t, c)
	for i := 1; i <= 2; i++ {
		result, err := c.Accounts(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if got := string(result.Accounts[0].Balance.Amount); got != fmt.Sprintf("%d.00", i) {
			t.Fatalf("amount %q", got)
		}
	}
	if loginCalls.Load() != 1 || reads.Load() != 2 {
		t.Fatal("session was not reused or data was cached")
	}
	for _, format := range []string{"%v", "%+v", "%#v"} {
		if text := fmt.Sprintf(format, c); strings.Contains(text, "access-1") || strings.Contains(text, "refresh-1") {
			t.Fatal("diagnostics contain credentials")
		}
	}
}

func TestMFAChallenge(t *testing.T) {
	var attempts atomic.Int32
	c := fixture(t, map[string]http.HandlerFunc{"/token": func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		if r.Header.Get("x-wealthsimple-otp") == "" {
			w.WriteHeader(400)
			writeJSON(w, map[string]string{"error": "invalid_grant"})
			return
		}
		if r.Header.Get("x-wealthsimple-otp") != "123456;remember=true" {
			t.Error("incorrect MFA header")
		}
		writeJSON(w, map[string]string{"access_token": "access-1", "refresh_token": "refresh-1"})
	}})
	if err := c.Login(context.Background(), "person@example.test", "password-fixture", ""); !errors.Is(err, ErrMFARequired) {
		t.Fatal(err)
	}
	if _, err := c.Accounts(context.Background()); !errors.Is(err, ErrNotConnected) {
		t.Fatal(err)
	}
	if err := c.Login(context.Background(), "person@example.test", "password-fixture", "123456"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Accounts(context.Background()); err != nil {
		t.Fatal(err)
	}
	if attempts.Load() != 2 {
		t.Fatal("unexpected login attempts")
	}
}

func TestLoginFailures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"bad credentials", 400, `{"error":"invalid_grant","error_description":"SECRET"}`, ErrLoginFailed},
		{"rate limit", 429, `SECRET`, ErrRateLimited},
		{"unavailable", 503, `SECRET`, ErrUpstream},
		{"html", 200, `<html>SECRET</html>`, ErrInvalidResponse},
		{"missing tokens", 200, `{}`, ErrInvalidResponse},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := fixture(t, map[string]http.HandlerFunc{"/token": func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) }})
			err := c.Login(context.Background(), "person@example.test", "password-fixture", "bad-code")
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v want %v", err, tc.want)
			}
			if strings.Contains(err.Error(), "SECRET") {
				t.Fatal("error discloses upstream body")
			}
		})
	}
}

func TestConcurrentRefreshUsesOneRotation(t *testing.T) {
	const workers = 8
	var stale, refreshes atomic.Int32
	ready := make(chan struct{})
	c := fixture(t, map[string]http.HandlerFunc{
		"/token": func(w http.ResponseWriter, r *http.Request) {
			var payload map[string]string
			_ = json.NewDecoder(r.Body).Decode(&payload)
			if payload["grant_type"] == "refresh_token" {
				refreshes.Add(1)
				if payload["refresh_token"] != "refresh-1" || r.Header.Get("Authorization") != "" {
					t.Error("incorrect refresh request")
				}
				writeJSON(w, map[string]string{"access_token": "access-2", "refresh_token": "refresh-2"})
				return
			}
			writeJSON(w, map[string]string{"access_token": "access-1", "refresh_token": "refresh-1"})
		},
		"/graphql": func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") == "Bearer access-1" {
				if stale.Add(1) == workers {
					close(ready)
				}
				select {
				case <-ready:
				case <-r.Context().Done():
					return
				}
				w.WriteHeader(401)
				fmt.Fprint(w, `{}`)
				return
			}
			if r.Header.Get("Authorization") != "Bearer access-2" {
				t.Error("retry used incorrect token")
			}
			writeJSON(w, accountResponse([]any{accountNode("account-1", "1.00", "CAD")}, false, nil))
		},
	})
	login(t, c)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.Accounts(ctx); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if refreshes.Load() != 1 {
		t.Fatalf("got %d refreshes", refreshes.Load())
	}
	s, err := c.snapshot()
	if err != nil || s.refreshToken != "refresh-2" {
		t.Fatal("rotated session was not retained")
	}
}

func TestRefreshOnGraphQLErrorAndTokenRotation(t *testing.T) {
	var refreshes, phase atomic.Int32
	phase.Store(1)
	c := fixture(t, map[string]http.HandlerFunc{
		"/token": func(w http.ResponseWriter, r *http.Request) {
			var payload map[string]string
			_ = json.NewDecoder(r.Body).Decode(&payload)
			version := int32(1)
			if payload["grant_type"] == "refresh_token" {
				version = refreshes.Add(1) + 1
				if payload["refresh_token"] != fmt.Sprintf("refresh-%d", version-1) {
					t.Error("previous refresh token reused")
				}
			}
			writeJSON(w, map[string]string{"access_token": fmt.Sprintf("access-%d", version), "refresh_token": fmt.Sprintf("refresh-%d", version)})
		},
		"/graphql": func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") == fmt.Sprintf("Bearer access-%d", phase.Load()) {
				fmt.Fprint(w, `{"errors":[{"message":"session expired","extensions":{"code":"UNAUTHENTICATED"}}]}`)
				return
			}
			writeJSON(w, accountResponse([]any{}, false, nil))
		},
	})
	login(t, c)
	for i := int32(1); i <= 2; i++ {
		phase.Store(i)
		if _, err := c.Accounts(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if refreshes.Load() != 2 {
		t.Fatal("expected two consecutive token rotations")
	}
}

func TestRefreshFailureAndRetryLimit(t *testing.T) {
	for _, rejectRefresh := range []bool{true, false} {
		t.Run(fmt.Sprint(rejectRefresh), func(t *testing.T) {
			var refreshes, queries atomic.Int32
			c := fixture(t, map[string]http.HandlerFunc{
				"/token": func(w http.ResponseWriter, r *http.Request) {
					var payload map[string]string
					_ = json.NewDecoder(r.Body).Decode(&payload)
					if payload["grant_type"] == "refresh_token" {
						refreshes.Add(1)
						if rejectRefresh {
							w.WriteHeader(400)
							fmt.Fprint(w, `{"error":"invalid_grant"}`)
							return
						}
					}
					writeJSON(w, map[string]string{"access_token": "access-1", "refresh_token": "refresh-1"})
				},
				"/graphql": func(w http.ResponseWriter, r *http.Request) { queries.Add(1); w.WriteHeader(401) },
			})
			login(t, c)
			if _, err := c.Accounts(context.Background()); !errors.Is(err, ErrReconnectRequired) {
				t.Fatal(err)
			}
			want := int32(2)
			if rejectRefresh {
				want = 1
			}
			if refreshes.Load() != 1 || queries.Load() != want {
				t.Fatal("unexpected retry count")
			}
		})
	}
}

func TestReadFailuresDoNotRefresh(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"forbidden", 403, `{}`, ErrUpstream}, {"rate limit", 429, `{}`, ErrRateLimited},
		{"server failure", 500, `{}`, ErrUpstream}, {"html", 200, `<html>SECRET</html>`, ErrInvalidResponse},
		{"empty response", 200, `{}`, ErrInvalidResponse}, {"graphql failure", 200, `{"errors":[{"message":"SECRET"}]}`, ErrUpstream},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			c := fixture(t, map[string]http.HandlerFunc{
				"/token": func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					fmt.Fprint(w, `{"access_token":"a","refresh_token":"r"}`)
				},
				"/graphql": func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) },
			})
			login(t, c)
			if _, err := c.Accounts(context.Background()); !errors.Is(err, tc.want) {
				t.Fatalf("got %v", err)
			}
			if calls.Load() != 1 {
				t.Fatal("non-authentication error triggered refresh")
			}
		})
	}
}

func TestCancellation(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	c := fixture(t, map[string]http.HandlerFunc{"/graphql": func(w http.ResponseWriter, r *http.Request) {
		// An HTTP/1 server may not observe the closed connection until the
		// request body is consumed. Always release the fixture during cleanup.
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}})
	login(t, c)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if _, err := c.Accounts(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
}

func TestClientsHaveSeparateSessionsAndCookieJars(t *testing.T) {
	first, second := fixture(t, nil), fixture(t, nil)
	login(t, first)
	if _, err := second.Accounts(context.Background()); !errors.Is(err, ErrNotConnected) {
		t.Fatal("session leaked to another client")
	}
	login(t, second)
	a, _ := first.snapshot()
	b, _ := second.snapshot()
	if a.sessionID == b.sessionID || first.http.Jar == second.http.Jar {
		t.Fatal("clients share connection state")
	}
}

func TestUntrustedLoginScriptAndTokenRedirect(t *testing.T) {
	var leaks atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { leaks.Add(1) }))
	defer other.Close()
	for _, path := range []string{"/login", "/token"} {
		t.Run(path, func(t *testing.T) {
			c := fixture(t, map[string]http.HandlerFunc{path: func(w http.ResponseWriter, r *http.Request) {
				if path == "/login" {
					http.SetCookie(w, &http.Cookie{Name: "wssdi", Value: "fixture"})
					fmt.Fprintf(w, `<script src="%s/app-unsafe.js"></script>`, other.URL)
					return
				}
				http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
			}})
			if err := c.Login(context.Background(), "person@example.test", "fixture", ""); err == nil {
				t.Fatal("untrusted request accepted")
			}
		})
	}
	if leaks.Load() != 0 {
		t.Fatal("request followed an untrusted origin")
	}
}
