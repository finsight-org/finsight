package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
)

func TestGetMeReturnsLocalDefaultPortfolioID(t *testing.T) {
	pool := httpAccountTestPool(t)
	ctx := context.Background()
	if err := bootstrap.New(pool).BootstrapLocal(ctx); err != nil {
		t.Fatalf("BootstrapLocal() error = %v", err)
	}
	resolver := localcontext.New(database.New(pool))
	want, err := resolver.DefaultPortfolioID(ctx)
	if err != nil {
		t.Fatalf("DefaultPortfolioID() error = %v", err)
	}
	router := NewRouter(Options{DeploymentMode: config.DeploymentModeLocal, LocalContext: resolver})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body generated.MeResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if uuid.UUID(body.DefaultPortfolioId) != want {
		t.Fatalf("default_portfolio_id = %s, want %s", uuid.UUID(body.DefaultPortfolioId), want)
	}
}

func TestLocalContextErrorMapping(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{name: "not found", err: localcontext.ErrNotFound, status: http.StatusNotFound, code: "local_context_not_found"},
		{name: "portfolio unavailable", err: localcontext.ErrPortfolioNotAllowed, status: http.StatusNotFound, code: "portfolio_not_found"},
		{name: "unexpected", err: errors.New("database credentials"), status: http.StatusInternalServerError, code: "local_context_lookup_failed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeLocalContextError(response, test.err)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
			if strings.Contains(response.Body.String(), "database credentials") {
				t.Fatal("response exposed database error")
			}
			assertErrorCode(t, response, test.code)
		})
	}
}

func TestGetMeRejectsNonLocalDeploymentModes(t *testing.T) {
	tests := []struct {
		name   string
		mode   config.DeploymentMode
		status int
		code   string
	}{
		{name: "managed", mode: config.DeploymentModeManaged, status: http.StatusNotImplemented, code: "managed_identity_not_implemented"},
		{name: "unsupported", mode: config.DeploymentMode("unknown"), status: http.StatusInternalServerError, code: "unsupported_deployment_mode"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := NewRouter(Options{DeploymentMode: test.mode})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
			assertErrorCode(t, response, test.code)
		})
	}
}
