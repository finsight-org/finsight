package wealthsimple

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"time"
)

const maxResponseBytes = 8 << 20

// Options permits transport injection for testing. Endpoints must only be
// configured by the application, never by an agent or an untrusted request.
type Options struct {
	HTTPClient   *http.Client
	LoginURL     string
	TokenURL     string
	TokenInfoURL string
	GraphQLURL   string
}

type Client struct {
	http    *http.Client
	urls    Options
	mu      sync.Mutex
	session session
}

func (*Client) String() string   { return "wealthsimple.Client{session: [redacted]}" }
func (*Client) GoString() string { return "wealthsimple.Client{session: [redacted]}" }

// NewClient performs no network requests and creates a private cookie jar.
func NewClient(opts Options) (*Client, error) {
	if opts.LoginURL == "" {
		opts.LoginURL = "https://my.wealthsimple.com/app/login"
	}
	if opts.TokenURL == "" {
		opts.TokenURL = "https://api.production.wealthsimple.com/v1/oauth/v2/token"
	}
	if opts.TokenInfoURL == "" {
		opts.TokenInfoURL = opts.TokenURL + "/info"
	}
	if opts.GraphQLURL == "" {
		opts.GraphQLURL = "https://my.wealthsimple.com/graphql"
	}
	for _, address := range []string{opts.LoginURL, opts.TokenURL, opts.TokenInfoURL, opts.GraphQLURL} {
		u, err := url.Parse(address)
		if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
			return nil, errors.New("invalid Wealthsimple endpoint configuration")
		}
	}
	transport := http.Client{Timeout: 30 * time.Second}
	if opts.HTTPClient != nil {
		transport = *opts.HTTPClient
		if transport.Timeout == 0 {
			transport.Timeout = 30 * time.Second
		}
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	transport.Jar = jar
	// Do not allow redirects to forward authentication headers to another origin.
	transport.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || len(via) == 0 || req.URL.Scheme != via[0].URL.Scheme || req.URL.Host != via[0].URL.Host {
			return http.ErrUseLastResponse
		}
		return nil
	}
	return &Client{http: &transport, urls: opts}, nil
}

func (c *Client) request(ctx context.Context, method, address string, payload any, headers http.Header) (int, []byte, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, ErrInvalidResponse
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, address, body)
	if err != nil {
		return 0, nil, ErrInvalidResponse
	}
	req.Header = headers.Clone()
	if req.Header == nil {
		req.Header = make(http.Header)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json, text/html;q=0.9, */*;q=0.8")
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, nil, ctx.Err()
		}
		// Transport errors and upstream bodies are deliberately not exposed.
		return 0, nil, ErrNetwork
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		if ctx.Err() != nil {
			return 0, nil, ctx.Err()
		}
		return 0, nil, ErrNetwork
	}
	if len(data) > maxResponseBytes {
		return 0, nil, ErrInvalidResponse
	}
	return resp.StatusCode, data, nil
}

func statusError(status int) error {
	switch {
	case status == http.StatusUnauthorized:
		return errUnauthenticated
	case status == http.StatusTooManyRequests:
		return ErrRateLimited
	case status < 200 || status >= 300:
		return ErrUpstream
	default:
		return nil
	}
}

func sessionHeaders(s session) http.Header {
	h := make(http.Header)
	h.Set("Authorization", "Bearer "+s.accessToken)
	h.Set("x-ws-device-id", s.deviceID)
	h.Set("x-ws-session-id", s.sessionID)
	return h
}

// authorized retries only an expired-session failure, and only once.
func (c *Client) authorized(ctx context.Context, call func(session) ([]byte, error)) ([]byte, error) {
	s, err := c.snapshot()
	if err != nil {
		return nil, err
	}
	data, err := call(s)
	if !errors.Is(err, errUnauthenticated) {
		return data, err
	}
	if err := c.refresh(ctx, s.generation); err != nil {
		return nil, err
	}
	s, err = c.snapshot()
	if err != nil {
		return nil, ErrReconnectRequired
	}
	data, err = call(s)
	if errors.Is(err, errUnauthenticated) {
		return nil, ErrReconnectRequired
	}
	return data, err
}

type graphError struct {
	Message    string `json:"message"`
	Extensions struct {
		Code string `json:"code"`
	} `json:"extensions"`
}

type graphResponse struct {
	Data   json.RawMessage `json:"data"`
	Errors []graphError    `json:"errors"`
}

func (c *Client) graphql(ctx context.Context, query string, variables any) (graphResponse, error) {
	data, err := c.authorized(ctx, func(s session) ([]byte, error) {
		h := sessionHeaders(s)
		h.Set("x-ws-profile", "trade")
		h.Set("x-ws-api-version", "12")
		h.Set("x-ws-locale", "en-CA")
		h.Set("x-platform-os", "web")
		status, data, err := c.request(ctx, http.MethodPost, c.urls.GraphQLURL, struct {
			Query         string `json:"query"`
			OperationName string `json:"operationName"`
			Variables     any    `json:"variables"`
		}{query, "FinSightAccounts", variables}, h)
		if err != nil {
			return nil, err
		}
		if err := statusError(status); err != nil {
			return nil, err
		}
		var envelope graphResponse
		if json.Unmarshal(data, &envelope) != nil {
			return nil, ErrInvalidResponse
		}
		for _, issue := range envelope.Errors {
			if issue.Extensions.Code == "UNAUTHENTICATED" || strings.EqualFold(strings.TrimSuffix(issue.Message, "."), "Not Authorized") {
				return nil, errUnauthenticated
			}
		}
		if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
			if len(envelope.Errors) > 0 {
				return nil, ErrUpstream
			}
			return nil, ErrInvalidResponse
		}
		return data, nil
	})
	if err != nil {
		return graphResponse{}, err
	}
	var result graphResponse
	if json.Unmarshal(data, &result) != nil {
		return graphResponse{}, ErrInvalidResponse
	}
	return result, nil
}
