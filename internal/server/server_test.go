package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/finsight-org/finsight/internal/wealthsimple"
)

const testToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func testClientFactory(t *testing.T, override func(w http.ResponseWriter, r *http.Request) bool) func() (*wealthsimple.Client, error) {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if override != nil && override(w, r) {
			return
		}
		switch r.URL.Path {
		case "/login":
			http.SetCookie(w, &http.Cookie{Name: "wssdi", Value: "device", Path: "/"})
			fmt.Fprint(w, `<script src="/assets/app-test.js"></script>`)
		case "/assets/app-test.js":
			fmt.Fprint(w, `const x={"production":true,clientId:"test-client"}`)
		case "/token":
			writeJSONTest(w, map[string]string{"access_token": "access", "refresh_token": "refresh"})
		case "/token/info":
			writeJSONTest(w, map[string]string{"identity_canonical_id": "identity"})
		case "/graphql":
			writeJSONTest(w, testAccountsResponse())
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(upstream.Close)
	return func() (*wealthsimple.Client, error) {
		return wealthsimple.NewClient(wealthsimple.Options{HTTPClient: upstream.Client(), LoginURL: upstream.URL + "/login", TokenURL: upstream.URL + "/token", GraphQLURL: upstream.URL + "/graphql"})
	}
}

func writeJSONTest(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
func testAccountsResponse() any {
	account := map[string]any{"id": "acct", "nickname": "Main", "unifiedAccountType": "TFSA", "currency": "CAD", "financials": map[string]any{"currentCombined": map[string]any{"netLiquidationValueV2": map[string]any{"amount": "12345678901234567890.123456789", "currency": "CAD"}}}}
	accounts := map[string]any{"edges": []any{map[string]any{"node": account}}, "pageInfo": map[string]any{"hasNextPage": false}}
	return map[string]any{"data": map[string]any{"identity": map[string]any{"netWorth": map[string]any{"accounts": accounts}}}}
}

func request(s *Server, method, path, body, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func TestTokenValidationAuthenticationAndNoStore(t *testing.T) {
	for _, value := range []string{"", "deadbeef", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"} {
		if _, err := New(value); err == nil {
			t.Fatalf("accepted token %q", value)
		}
	}
	var creations atomic.Int32
	s, err := newServer(testToken, func() (*wealthsimple.Client, error) { creations.Add(1); return nil, fmt.Errorf("unexpected") })
	if err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []struct{ method, path, body string }{{"POST", "/connections/wealthsimple/login", `{"email":"x","password":"y"}`}, {"DELETE", "/connections/wealthsimple", ""}, {"POST", "/graphql", `{"query":"{connectedProviders{id}}"}`}} {
		w := request(s, endpoint.method, endpoint.path, endpoint.body, "")
		if w.Code != 401 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: status=%d cache=%q", endpoint.path, w.Code, w.Header().Get("Cache-Control"))
		}
	}
	if creations.Load() != 0 {
		t.Fatal("unauthenticated request initialized a provider client")
	}
	if w := request(s, "POST", "/graphql", `{"query":"{connectedProviders{id}}"}`, testToken+"zz"); w.Code != 401 {
		t.Fatalf("malformed hex token suffix authenticated: %d", w.Code)
	}
	if w := request(s, "POST", "/connections/wealthsimple/login", `{"email":"","password":""}`, testToken); w.Code != 400 {
		t.Fatalf("missing credentials status %d", w.Code)
	}
}

func TestDisconnectedSchemaIntrospectionUnknownProviderAndLimits(t *testing.T) {
	s, err := New(testToken)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, query := range []string{`query { connectedProviders { id } providerSchema(provider:"wealthsimple") }`, `query { __schema { queryType { name } } }`} {
		w := request(s, "POST", "/graphql", mustJSON(t, map[string]any{"query": query}), testToken)
		if w.Code != 200 {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		var response map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if response["errors"] != nil {
			t.Fatalf("GraphQL errors: %s", w.Body.String())
		}
		if strings.Contains(query, "__schema") {
			data := response["data"].(map[string]any)
			schema := data["__schema"].(map[string]any)
			queryType := schema["queryType"].(map[string]any)
			if queryType["name"] != "Query" {
				t.Fatalf("unexpected introspection result: %s", w.Body.String())
			}
		}
	}
	unknown := `query { providerSchema(provider:"other") }`
	w := request(s, "POST", "/graphql", mustJSON(t, map[string]any{"query": unknown}), testToken)
	if !strings.Contains(w.Body.String(), "PROVIDER_NOT_FOUND") {
		t.Fatalf("missing stable provider error: %s", w.Body.String())
	}
	oversize := `{"query":"` + strings.Repeat(" ", maxQuery+1) + `"}`
	if w = request(s, "POST", "/graphql", oversize, testToken); w.Code != 413 {
		t.Fatalf("query size status %d", w.Code)
	}
	largeBody := `{"query":"{ connectedProviders { id } }","x":"` + strings.Repeat("a", maxBody) + `"}`
	if w = request(s, "POST", "/graphql", largeBody, testToken); w.Code != 413 {
		t.Fatalf("body size status %d", w.Code)
	}
	if w = request(s, "POST", "/graphql", `{"query":"{ connectedProviders { id } }"}`, testToken); !strings.Contains(w.Body.String(), "connectedProviders") {
		t.Fatalf("introspection query failed: %s", w.Body.String())
	}
	var complexity strings.Builder
	complexity.WriteString("{")
	for i := 0; i < 510; i++ {
		fmt.Fprintf(&complexity, "p%d: connectedProviders { id } ", i)
	}
	complexity.WriteString("}")
	w = request(s, "POST", "/graphql", mustJSON(t, map[string]any{"query": complexity.String()}), testToken)
	if !strings.Contains(w.Body.String(), "errors") {
		t.Fatalf("complexity limit did not reject query: %s", w.Body.String())
	}
	outer := `query($q:String!){executeProviderQuery(provider:"wealthsimple",query:$q){data}}`
	w = request(s, "POST", "/graphql", mustJSON(t, map[string]any{"query": outer, "variables": map[string]any{"q": strings.Repeat(" ", (64<<10)+1)}}), testToken)
	if !strings.Contains(w.Body.String(), "QUERY_TOO_LARGE") {
		t.Fatalf("nested provider query size limit missing: %s", w.Body.String())
	}
}

func TestLoginMFAAndProviderQueryAliasPrecision(t *testing.T) {
	var logins, reads atomic.Int32
	factory := testClientFactory(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path == "/token" {
			_, _ = io.Copy(io.Discard, r.Body)
			logins.Add(1)
			var req map[string]any
			_ = json.NewDecoder(r.Body).Decode(&req)
			if r.Header.Get("x-wealthsimple-otp") == "" {
				w.WriteHeader(400)
				writeJSONTest(w, map[string]string{"error": "invalid_grant"})
				return true
			}
			writeJSONTest(w, map[string]string{"access_token": "access", "refresh_token": "refresh"})
			return true
		}
		if r.URL.Path == "/graphql" {
			_, _ = io.Copy(io.Discard, r.Body)
			reads.Add(1)
			response := testAccountsResponse().(map[string]any)
			response["errors"] = []any{map[string]any{"message": "SECRET upstream GraphQL detail"}}
			writeJSONTest(w, response)
			return true
		}
		return false
	})
	s, err := newServer(testToken, factory)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	loginBody := `{"email":"Person@example.test","password":"not-logged","mfaCode":""}`
	w := request(s, "POST", "/connections/wealthsimple/login", loginBody, testToken)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "mfa_required") {
		t.Fatalf("MFA status: %d %s", w.Code, w.Body.String())
	}
	s.manager.mu.Lock()
	pendingTimer := s.manager.pendingTimer
	s.manager.mu.Unlock()
	if got := request(s, "POST", "/connections/wealthsimple/login", `{"email":"person@example.test","password":"new-password","mfaCode":"123456"}`, testToken); got.Code != 200 || !strings.Contains(got.Body.String(), "connected") {
		t.Fatalf("MFA completion: %d %s", got.Code, got.Body.String())
	}
	if pendingTimer == nil || pendingTimer.Stop() {
		t.Fatal("completed MFA left its expiry timer active")
	}
	providerQuery := `query AccountRead($include:Boolean!) { a: accounts @include(if:$include) { accounts { id balance { amount currency } } warnings { code } } b: accounts @include(if:$include) { accounts { id } } }`
	outer := `query ProviderRead($q:String!,$vars:JSON,$op:String){executeProviderQuery(provider:"wealthsimple",query:$q,variables:$vars,operationName:$op){data errors{message path extensions}}}`
	w = request(s, "POST", "/graphql", mustJSON(t, map[string]any{"query": outer, "operationName": "ProviderRead", "variables": map[string]any{"q": providerQuery, "vars": map[string]any{"include": true}, "op": "AccountRead"}}), testToken)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "12345678901234567890.123456789") {
		t.Fatalf("provider response lost exact decimal: %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "Some account information is unavailable.") || !strings.Contains(w.Body.String(), `"path":[`) || strings.Contains(w.Body.String(), "SECRET") {
		t.Fatalf("partial error/path contract failed: %s", w.Body.String())
	}
	if reads.Load() != 1 || !strings.Contains(w.Body.String(), `"a"`) || !strings.Contains(w.Body.String(), `"b"`) {
		t.Fatalf("expected one provider fetch shared across aliases; calls=%d response=%s", reads.Load(), w.Body.String())
	}
	conflict := request(s, "POST", "/connections/wealthsimple/login", loginBody, testToken)
	if conflict.Code != 409 {
		t.Fatalf("connected login status %d", conflict.Code)
	}
	if got := request(s, "DELETE", "/connections/wealthsimple", "", testToken); got.Code != 204 {
		t.Fatalf("disconnect %d", got.Code)
	}
}

func TestPendingMFARulesAndExpiry(t *testing.T) {
	factory := testClientFactory(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path == "/token" {
			w.WriteHeader(400)
			writeJSONTest(w, map[string]string{"error": "invalid_grant"})
			return true
		}
		return false
	})
	s, err := newServer(testToken, factory)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	w := request(s, "POST", "/connections/wealthsimple/login", `{"email":"a@example.test","password":"p"}`, testToken)
	if w.Code != 200 {
		t.Fatalf("first challenge %d", w.Code)
	}
	w = request(s, "POST", "/connections/wealthsimple/login", `{"email":"b@example.test","password":"p","mfaCode":"123"}`, testToken)
	if w.Code != 422 || !strings.Contains(w.Body.String(), "MFA_MISMATCH") {
		t.Fatalf("mismatch %d %s", w.Code, w.Body.String())
	}
	s.manager.mu.Lock()
	s.manager.expires = time.Now().Add(-time.Second)
	s.manager.mu.Unlock()
	w = request(s, "POST", "/connections/wealthsimple/login", `{"email":"a@example.test","password":"p","mfaCode":"123"}`, testToken)
	if w.Code != 422 || !strings.Contains(w.Body.String(), "MFA_EXPIRED") {
		t.Fatalf("expired %d %s", w.Code, w.Body.String())
	}
	if s.manager.client != nil || s.manager.state != stateDisconnected {
		t.Fatal("expired pending client was retained")
	}
}

func TestRefreshRejectionRemovesConnectionFromDiscovery(t *testing.T) {
	factory := testClientFactory(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path == "/token" {
			_, _ = io.Copy(io.Discard, r.Body)
			var request map[string]any
			_ = json.NewDecoder(r.Body).Decode(&request)
			if request["grant_type"] == "refresh_token" {
				w.WriteHeader(400)
				writeJSONTest(w, map[string]string{"error": "invalid_grant", "error_description": "SECRET"})
				return true
			}
			writeJSONTest(w, map[string]string{"access_token": "access", "refresh_token": "refresh"})
			return true
		}
		if r.URL.Path == "/graphql" {
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"message":"SECRET"}`)
			return true
		}
		return false
	})
	s, err := newServer(testToken, factory)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if w := request(s, "POST", "/connections/wealthsimple/login", `{"email":"a@example.test","password":"pw"}`, testToken); w.Code != 200 {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	providerQuery := `{accounts{accounts{id}}}`
	outer := `query($q:String!){executeProviderQuery(provider:"wealthsimple",query:$q){data errors{message extensions}}}`
	w := request(s, "POST", "/graphql", mustJSON(t, map[string]any{"query": outer, "variables": map[string]any{"q": providerQuery}}), testToken)
	if strings.Contains(w.Body.String(), "SECRET") || !strings.Contains(w.Body.String(), "RECONNECT_REQUIRED") {
		t.Fatalf("refresh error was unsafe or missing: %s", w.Body.String())
	}
	w = request(s, "POST", "/graphql", `{"query":"{connectedProviders{id}}"}`, testToken)
	if !strings.Contains(w.Body.String(), `"connectedProviders":[]`) {
		t.Fatalf("rejected refresh left provider connected: %s", w.Body.String())
	}
}

func TestDisconnectDuringProviderReadSuppressesDiscardedData(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	factory := testClientFactory(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path == "/graphql" {
			_, _ = io.Copy(io.Discard, r.Body)
			close(started)
			<-release
			writeJSONTest(w, testAccountsResponse())
			return true
		}
		return false
	})
	s, err := newServer(testToken, factory)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if w := request(s, "POST", "/connections/wealthsimple/login", `{"email":"a@example.test","password":"pw"}`, testToken); w.Code != 200 {
		t.Fatalf("login: %s", w.Body.String())
	}
	outer := `query($q:String!){executeProviderQuery(provider:"wealthsimple",query:$q){data errors{message extensions}}}`
	r := httptest.NewRequest("POST", "/graphql", strings.NewReader(mustJSON(t, map[string]any{"query": outer, "variables": map[string]any{"q": `{accounts{accounts{balance{amount}}}}`}})))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+testToken)
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { s.Handler().ServeHTTP(w, r); close(done) }()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("provider query did not start")
	}
	s.manager.Disconnect()
	close(release)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("query did not cancel after disconnect")
	}
	if strings.Contains(w.Body.String(), "12345678901234567890.123456789") {
		t.Fatalf("discarded account data escaped: %s", w.Body.String())
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestManagerDisconnectCancelsLeaseAndRejectsStaleResult(t *testing.T) {
	m := newConnectionManager(func() (*wealthsimple.Client, error) { return wealthsimple.NewClient(wealthsimple.Options{}) })
	m.mu.Lock()
	m.state = stateConnected
	m.client, _ = wealthsimple.NewClient(wealthsimple.Options{})
	m.connCtx, m.connCancel = context.WithCancel(context.Background())
	m.generation = 7
	m.mu.Unlock()
	l, err := m.acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	m.Disconnect()
	defer l.release()
	select {
	case <-l.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("disconnect did not cancel leased work")
	}
	if m.current(l.generation) {
		t.Fatal("discarded generation is still current")
	}
}

func TestShutdownDuringLoginCannotRestoreConnection(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	factory := testClientFactory(t, func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path == "/token" {
			_, _ = io.Copy(io.Discard, r.Body)
			close(entered)
			select {
			case <-release:
				writeJSONTest(w, map[string]string{"access_token": "late-access", "refresh_token": "late-refresh"})
			case <-r.Context().Done():
			}
			return true
		}
		return false
	})
	m := newConnectionManager(factory)
	result := make(chan error, 1)
	go func() { _, err := m.Login(context.Background(), "a@example.test", "pw", ""); result <- err }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("login did not reach mock upstream")
	}
	m.Shutdown()
	close(release)
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("canceled login unexpectedly succeeded")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("shutdown did not cancel login")
	}
	if m.connected() || m.client != nil {
		t.Fatal("late login restored a closed connection")
	}
	if _, err := m.Login(context.Background(), "a@example.test", "pw", ""); err != errServerClosed {
		t.Fatalf("login after shutdown: %v", err)
	}
	if _, err := m.acquire(context.Background()); err == nil {
		t.Fatal("acquire succeeded after shutdown")
	}
}
