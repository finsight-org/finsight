package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/finsight-org/finsight/internal/gateway"
	"github.com/finsight-org/finsight/internal/gateway/resolver"
	"github.com/finsight-org/finsight/internal/wealthsimple"
)

const maxBody = 256 << 10
const maxQuery = 64 << 10

type Server struct {
	handler   http.Handler
	manager   *connectionManager
	tokenHash [32]byte
}

func New(token string) (*Server, error) {
	return newServer(token, func() (*wealthsimple.Client, error) { return wealthsimple.NewClient(wealthsimple.Options{}) })
}

func newServer(token string, factory func() (*wealthsimple.Client, error)) (*Server, error) {
	decoded, err := hex.DecodeString(token)
	if err != nil || len(decoded) < 32 {
		return nil, errors.New("FINSIGHT_API_TOKEN must be hex encoding at least 32 random bytes")
	}
	manager := newConnectionManager(factory)
	gr := &resolver.Resolver{Connected: manager.connected, Client: func(ctx context.Context) (resolver.AccountsClient, error) {
		l, err := manager.acquire(ctx)
		if err != nil {
			return nil, err
		}
		wrapper := &leasedClient{lease: l, manager: manager}
		context.AfterFunc(ctx, l.release)
		return wrapper, nil
	}}
	api, err := gateway.New(gr, gateway.SchemaSDL)
	if err != nil {
		return nil, err
	}
	s := &Server{manager: manager, tokenHash: sha256.Sum256(decoded)}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /connections/wealthsimple/login", s.login)
	mux.HandleFunc("DELETE /connections/wealthsimple", s.disconnect)
	mux.HandleFunc("POST /graphql", s.graphql(api))
	s.handler = s.auth(mux)
	return s, nil
}

func (s *Server) Handler() http.Handler { return s.handler }
func (s *Server) Close()                { s.manager.Shutdown() }

func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		got := strings.TrimSpace(r.Header.Get("Authorization"))
		parts := strings.SplitN(got, " ", 2)
		var supplied []byte
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
			if decoded, err := hex.DecodeString(parts[1]); err == nil {
				supplied = decoded
			}
		}
		// Hashing both values keeps the comparison fixed width, including malformed tokens.
		gotHash := sha256.Sum256(supplied)
		valid := subtle.ConstantTimeCompare(s.tokenHash[:], gotHash[:])
		if valid != 1 || len(supplied) < 32 {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "FinSight API authentication failed.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		MFACode  string `json:"mfaCode"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeDecodeError(w, err)
		return
	}
	if strings.TrimSpace(body.Email) == "" || body.Password == "" {
		writeError(w, 400, "MALFORMED_REQUEST", "Email and password are required.")
		return
	}
	status, err := s.manager.Login(r.Context(), body.Email, body.Password, body.MFACode)
	body.Password = ""
	body.MFACode = ""
	if err != nil {
		statusCode, code, msg := mapConnectionError(err)
		writeError(w, statusCode, code, msg)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": status})
}

func (s *Server) disconnect(w http.ResponseWriter, r *http.Request) {
	s.manager.Disconnect()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) graphql(api *gateway.API) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query         string         `json:"query"`
			Variables     map[string]any `json:"variables"`
			OperationName string         `json:"operationName"`
		}
		if err := decodeJSON(w, r, &body); err != nil {
			writeDecodeError(w, err)
			return
		}
		if len(body.Query) > maxQuery {
			writeError(w, 413, "REQUEST_TOO_LARGE", "GraphQL query is too large.")
			return
		}
		if strings.TrimSpace(body.Query) == "" {
			writeError(w, 400, "MALFORMED_REQUEST", "A GraphQL query is required.")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
		defer cancel()
		response := api.Execute(ctx, body.Query, body.Variables, body.OperationName)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(response)
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	mediaType, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaErr != nil || mediaType != "application/json" {
		return fmt.Errorf("json required")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	dec.UseNumber()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return fmt.Errorf("trailing body")
	}
	return nil
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeDecodeError(w http.ResponseWriter, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE", "Request body is too large.")
		return
	}
	writeError(w, http.StatusBadRequest, "MALFORMED_REQUEST", "Request body is invalid.")
}

func mapConnectionError(err error) (int, string, string) {
	switch {
	case errors.Is(err, errServerClosed):
		return http.StatusServiceUnavailable, "SERVER_SHUTTING_DOWN", "FinSight is shutting down."
	case errors.Is(err, errAlreadyConnected):
		return 409, "CONNECTION_EXISTS", "Disconnect Wealthsimple before connecting again."
	case errors.Is(err, errPendingExpired):
		return 422, "MFA_EXPIRED", "The MFA challenge expired; start login again."
	case errors.Is(err, errEmailMismatch):
		return 422, "MFA_MISMATCH", "The pending MFA challenge does not match this email."
	case errors.Is(err, errMissingMFA):
		return 422, "MFA_REQUIRED", "A pending MFA challenge is required."
	case errors.Is(err, wealthsimple.ErrRateLimited):
		return 429, "RATE_LIMITED", "Wealthsimple is limiting requests; try again later."
	case errors.Is(err, wealthsimple.ErrMFARequired):
		return 422, "MFA_REQUIRED", "Wealthsimple requires an MFA code."
	case errors.Is(err, wealthsimple.ErrLoginFailed):
		return 422, "INVALID_CREDENTIALS", "Wealthsimple login failed."
	case errors.Is(err, context.DeadlineExceeded):
		return 504, "DEADLINE_EXCEEDED", "The request deadline expired."
	default:
		return 502, "UPSTREAM_ERROR", "Wealthsimple could not complete the request."
	}
}

func (c *leasedClient) Accounts(ctx context.Context) (wealthsimple.AccountsResult, error) {
	result, err := c.lease.client.Accounts(c.lease.ctx)
	if errors.Is(err, wealthsimple.ErrReconnectRequired) || errors.Is(err, wealthsimple.ErrNotConnected) {
		c.manager.removeIfCurrent(c.lease.generation)
		return wealthsimple.AccountsResult{}, wealthsimple.ErrReconnectRequired
	}
	if !c.manager.current(c.lease.generation) {
		return wealthsimple.AccountsResult{}, errStale
	}
	return result, err
}

func (c *leasedClient) Valid() bool { return c.manager.current(c.lease.generation) }

type leasedClient struct {
	lease   lease
	manager *connectionManager
}
