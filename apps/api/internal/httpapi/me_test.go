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

	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
)

func TestGetMeReturnsLocalDefaultPortfolioID(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	router := NewRouter(Options{
		DeploymentMode: config.DeploymentModeLocal,
		LocalContext:   &fakeLocalContextService{portfolioID: portfolioID},
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var body generated.MeResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if uuid.UUID(body.DefaultPortfolioId) != portfolioID {
		t.Fatalf("default_portfolio_id = %s, want %s", uuid.UUID(body.DefaultPortfolioId), portfolioID)
	}
}

func TestGetMeReturnsNotFoundWhenLocalContextIsMissing(t *testing.T) {
	router := NewRouter(Options{
		DeploymentMode: config.DeploymentModeLocal,
		LocalContext:   &fakeLocalContextService{err: localcontext.ErrNotFound},
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	assertErrorCode(t, response, "local_context_not_found")
}

func TestGetMeReturnsInternalServerErrorWhenLookupFails(t *testing.T) {
	router := NewRouter(Options{
		DeploymentMode: config.DeploymentModeLocal,
		LocalContext:   &fakeLocalContextService{err: errors.New("database credentials")},
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	if strings.Contains(response.Body.String(), "database credentials") {
		t.Fatal("response exposed repository error")
	}
	assertErrorCode(t, response, "local_context_lookup_failed")
}

func TestGetMeReturnsNotImplementedInManagedModeWithoutLookup(t *testing.T) {
	localContext := &fakeLocalContextService{}
	router := NewRouter(Options{
		DeploymentMode: config.DeploymentModeManaged,
		LocalContext:   localContext,
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))

	if response.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotImplemented)
	}
	assertErrorCode(t, response, "managed_identity_not_implemented")
	if localContext.calls != 0 {
		t.Fatalf("DefaultPortfolioID() calls = %d, want 0", localContext.calls)
	}
}

func TestGetMeReturnsDescriptiveErrorForUnsupportedDeploymentMode(t *testing.T) {
	localContext := &fakeLocalContextService{}
	router := NewRouter(Options{
		DeploymentMode: config.DeploymentMode("unknown"),
		LocalContext:   localContext,
	})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/me", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}
	assertErrorCode(t, response, "unsupported_deployment_mode")
	if localContext.calls != 0 {
		t.Fatalf("DefaultPortfolioID() calls = %d, want 0", localContext.calls)
	}
}

type fakeLocalContextService struct {
	portfolioID uuid.UUID
	err         error
	calls       int
}

func (s *fakeLocalContextService) DefaultPortfolioID(context.Context) (uuid.UUID, error) {
	s.calls++
	return s.portfolioID, s.err
}

func (s *fakeLocalContextService) EnsurePortfolio(context.Context, uuid.UUID) error {
	return s.err
}
