package wealthsimple

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

var (
	scriptSourcePattern     = regexp.MustCompile(`(?i)<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']`)
	productionClientPattern = regexp.MustCompile(`(?s)["']production["'][^}]{0,1000}\bclientId\s*:\s*["']([a-zA-Z0-9_-]+)["']`)
)

// Login establishes a new in-memory connection. On ErrMFARequired, call Login
// again with the same credentials and an MFA code. No credentials are persisted.
// Login and refresh serialize changes to the connection's session.
func (c *Client) Login(ctx context.Context, email, password, code string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if strings.TrimSpace(email) == "" || password == "" {
		return ErrLoginFailed
	}
	c.session.accessToken = ""
	c.session.refreshToken = ""
	c.session.generation++
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.session.deviceID == "" || c.session.clientID == "" {
		if err := c.bootstrap(ctx); err != nil {
			return err
		}
	}
	h := make(http.Header)
	h.Set("x-wealthsimple-client", "@wealthsimple/wealthsimple")
	h.Set("x-ws-profile", "undefined")
	h.Set("x-ws-device-id", c.session.deviceID)
	h.Set("x-ws-session-id", c.session.sessionID)
	if code != "" {
		h.Set("x-wealthsimple-otp", code+";remember=true")
	}
	status, body, err := c.request(ctx, http.MethodPost, c.urls.TokenURL, map[string]any{
		"grant_type": "password", "username": strings.TrimSpace(email), "password": password,
		"client_id": c.session.clientID, "scope": "invest.read trade.read tax.read",
		"skip_provision": "true", "otp_claim": nil,
	}, h)
	if err != nil {
		return err
	}
	if status == http.StatusTooManyRequests {
		return ErrRateLimited
	}
	if status >= 500 || (status >= 300 && status != 400 && status != 401) {
		return ErrUpstream
	}
	var tokens tokenResponse
	if json.Unmarshal(body, &tokens) != nil {
		return ErrInvalidResponse
	}
	if tokens.Error != "" {
		// This unofficial flow can use invalid_grant for the initial MFA
		// challenge as well as invalid credentials. The CLI prompts only once.
		if code == "" && (tokens.Error == "invalid_grant" || tokens.Error == "otp_required" || tokens.Error == "mfa_required") {
			return ErrMFARequired
		}
		return ErrLoginFailed
	}
	if status < 200 || status >= 300 {
		return ErrLoginFailed
	}
	if tokens.AccessToken == "" || tokens.RefreshToken == "" {
		return ErrInvalidResponse
	}
	c.session.accessToken = tokens.AccessToken
	c.session.refreshToken = tokens.RefreshToken
	c.session.generation++
	return nil
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	Error        string `json:"error"`
}

// bootstrap runs while mu is held. Only public login assets are fetched.
func (c *Client) bootstrap(ctx context.Context) error {
	status, body, err := c.request(ctx, http.MethodGet, c.urls.LoginURL, nil, nil)
	if err != nil {
		return err
	}
	if err := statusError(status); err != nil {
		return err
	}
	loginURL, _ := url.Parse(c.urls.LoginURL)
	device := ""
	for _, cookie := range c.http.Jar.Cookies(loginURL) {
		if cookie.Name == "wssdi" {
			device = cookie.Value
		}
	}
	if device == "" {
		return ErrInvalidResponse
	}
	var scriptURL *url.URL
	for _, match := range scriptSourcePattern.FindAllSubmatch(body, -1) {
		u, err := loginURL.Parse(html.UnescapeString(string(match[1])))
		if err != nil || !strings.Contains(u.Path, "/app-") || !strings.HasSuffix(u.Path, ".js") {
			continue
		}
		// The login document is upstream input. It must not cause requests to
		// unrelated hosts or downgrade HTTPS. Same-origin HTTP is for tests.
		sameOrigin := u.Scheme == loginURL.Scheme && u.Host == loginURL.Host
		firstParty := u.Scheme == "https" && (u.Hostname() == "wealthsimple.com" || strings.HasSuffix(u.Hostname(), ".wealthsimple.com"))
		if u.User == nil && (sameOrigin || firstParty) {
			scriptURL = u
			break
		}
	}
	if scriptURL == nil {
		return ErrInvalidResponse
	}
	status, script, err := c.request(ctx, http.MethodGet, scriptURL.String(), nil, nil)
	if err != nil {
		return err
	}
	if err := statusError(status); err != nil {
		return err
	}
	match := productionClientPattern.FindSubmatch(script)
	if len(match) != 2 {
		return ErrInvalidResponse
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return ErrInvalidResponse
	}
	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	c.session.sessionID = fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
	c.session.clientID = string(match[1])
	c.session.deviceID = device
	return nil
}

func (c *Client) refresh(ctx context.Context, failedGeneration uint64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.session.accessToken == "" || c.session.refreshToken == "" {
		return ErrReconnectRequired
	}
	if c.session.generation != failedGeneration {
		// A concurrent read already rotated the tokens.
		return nil
	}
	h := make(http.Header)
	h.Set("x-wealthsimple-client", "@wealthsimple/wealthsimple")
	h.Set("x-ws-profile", "invest")
	h.Set("x-ws-device-id", c.session.deviceID)
	h.Set("x-ws-session-id", c.session.sessionID)
	status, body, err := c.request(ctx, http.MethodPost, c.urls.TokenURL, map[string]string{
		"grant_type": "refresh_token", "refresh_token": c.session.refreshToken, "client_id": c.session.clientID,
	}, h)
	if err != nil {
		return err
	}
	if status == http.StatusTooManyRequests {
		return ErrRateLimited
	}
	if status >= 500 || (status >= 300 && status != 400 && status != 401) {
		return ErrUpstream
	}
	var tokens tokenResponse
	if json.Unmarshal(body, &tokens) != nil {
		return ErrInvalidResponse
	}
	if status == 400 || status == 401 || tokens.Error != "" || tokens.AccessToken == "" || tokens.RefreshToken == "" {
		c.session.accessToken = ""
		c.session.refreshToken = ""
		c.session.generation++
		return ErrReconnectRequired
	}
	c.session.accessToken = tokens.AccessToken
	c.session.refreshToken = tokens.RefreshToken
	c.session.generation++
	return nil
}

func (c *Client) identity(ctx context.Context) (string, error) {
	body, err := c.authorized(ctx, func(s session) ([]byte, error) {
		h := sessionHeaders(s)
		h.Set("x-wealthsimple-client", "@wealthsimple/wealthsimple")
		status, body, err := c.request(ctx, http.MethodGet, c.urls.TokenInfoURL, nil, h)
		if err != nil {
			return nil, err
		}
		if err := statusError(status); err != nil {
			return nil, err
		}
		var info struct {
			Identity string `json:"identity_canonical_id"`
			Message  string `json:"message"`
		}
		if json.Unmarshal(body, &info) != nil {
			return nil, ErrInvalidResponse
		}
		if strings.EqualFold(strings.TrimSuffix(info.Message, "."), "Not Authorized") {
			return nil, errUnauthenticated
		}
		if info.Identity == "" {
			return nil, ErrInvalidResponse
		}
		return []byte(info.Identity), nil
	})
	return string(body), err
}
