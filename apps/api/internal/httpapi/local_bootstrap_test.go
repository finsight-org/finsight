package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/identity"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

func TestLocalBootstrapWhenContextIsCreated(t *testing.T) {
	router := NewRouter(Options{
		ServiceName:  "finsight-api",
		Version:      "dev",
		ReadyTimeout: time.Second,
		Database:     fakePinger{},
		Bootstrap: fakeBootstrapper{
			result: bootstrapResult(true),
		},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/local/bootstrap", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusCreated)
	}

	var body generated.LocalBootstrapResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.Created {
		t.Fatal("created = false, want true")
	}
	if body.User.Email != "local@finsight.local" {
		t.Fatalf("user email = %q, want local@finsight.local", body.User.Email)
	}
	if body.Workspace.AuthMode != "local" {
		t.Fatalf("workspace auth mode = %q, want local", body.Workspace.AuthMode)
	}
	if !body.Portfolio.IsDefault {
		t.Fatal("portfolio is_default = false, want true")
	}
}

func TestLocalBootstrapWhenContextAlreadyExists(t *testing.T) {
	router := NewRouter(Options{
		ServiceName:  "finsight-api",
		Version:      "dev",
		ReadyTimeout: time.Second,
		Database:     fakePinger{},
		Bootstrap: fakeBootstrapper{
			result: bootstrapResult(false),
		},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/local/bootstrap", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
}

func TestLocalBootstrapWhenServiceFails(t *testing.T) {
	router := NewRouter(Options{
		ServiceName:  "finsight-api",
		Version:      "dev",
		ReadyTimeout: time.Second,
		Database:     fakePinger{},
		Bootstrap: fakeBootstrapper{
			err: errors.New("database unavailable"),
		},
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/local/bootstrap", nil)
	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusInternalServerError)
	}

	var body generated.ErrorResponse
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Error.Code != "bootstrap_failed" {
		t.Fatalf("error code = %q, want bootstrap_failed", body.Error.Code)
	}
}

type fakeBootstrapper struct {
	result bootstrap.Result
	err    error
}

func (b fakeBootstrapper) BootstrapLocal(context.Context) (bootstrap.Result, error) {
	return b.result, b.err
}

func bootstrapResult(created bool) bootstrap.Result {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	return bootstrap.Result{
		Created: created,
		User: identity.User{
			ID:          userID,
			Email:       "local@finsight.local",
			DisplayName: "Local User",
		},
		Workspace: identity.Workspace{
			ID:           workspaceID,
			Name:         "Local Workspace",
			BaseCurrency: "CAD",
			AuthMode:     "local",
		},
		Membership: identity.WorkspaceMembership{
			ID:          uuid.MustParse("33333333-3333-3333-3333-333333333333"),
			WorkspaceID: workspaceID,
			UserID:      userID,
			Role:        "owner",
		},
		Portfolio: portfolio.Portfolio{
			ID:           uuid.MustParse("44444444-4444-4444-4444-444444444444"),
			WorkspaceID:  workspaceID,
			Name:         "Default Portfolio",
			BaseCurrency: "CAD",
			IsDefault:    true,
		},
	}
}
