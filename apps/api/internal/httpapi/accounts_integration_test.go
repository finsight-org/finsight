package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/config"
	"github.com/finsight-org/finsight/apps/api/internal/localcontext"
	"github.com/finsight-org/finsight/apps/api/internal/openapi/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestAccountHTTPFlowWithPostgres(t *testing.T) {
	pool := httpAccountTestPool(t)
	ctx := context.Background()
	bootstrapResult, err := bootstrap.NewService(bootstrap.NewPostgresRepository(pool)).BootstrapLocal(ctx)
	if err != nil {
		t.Fatalf("BootstrapLocal() error = %v", err)
	}
	portfolioID := bootstrapResult.Portfolio.ID
	prefix := "HTTP Account " + uuid.NewString()
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `delete from accounts where portfolio_id = $1 and name like $2`, portfolioID, prefix+"%"); err != nil {
			t.Fatalf("delete HTTP test accounts: %v", err)
		}
	})

	router := NewRouter(Options{
		DeploymentMode: config.DeploymentModeLocal,
		LocalContext:   localcontext.NewService(localcontext.NewPostgresRepository(pool)),
		Accounts:       account.New(database.New(pool)),
	})
	name := prefix + " Margin"
	body := fmt.Sprintf(`{"name":%q,"institution_name":"Questrade","type":"BROKERAGE","base_currency":"CAD","external_reference":%q}`, name, prefix+"-margin")
	createdResponse := serveAccountJSON(t, router, http.MethodPost, "/api/portfolios/"+portfolioID.String()+"/accounts", body)
	if createdResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d; body = %s", createdResponse.Code, http.StatusCreated, createdResponse.Body.String())
	}
	var created generated.Account
	if err := json.NewDecoder(createdResponse.Body).Decode(&created); err != nil {
		t.Fatalf("decode created account: %v", err)
	}
	if created.Name != name || created.Type != generated.BROKERAGE || created.BaseCurrency != "CAD" {
		t.Fatalf("created account = %#v", created)
	}
	if created.InstitutionName == nil || *created.InstitutionName != "Questrade" {
		t.Fatalf("institution name = %#v", created.InstitutionName)
	}

	accountID := uuid.UUID(created.Id)
	getResponse := httptest.NewRecorder()
	router.ServeHTTP(getResponse, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/accounts/"+accountID.String(), nil))
	if getResponse.Code != http.StatusOK {
		t.Fatalf("get status = %d, want %d; body = %s", getResponse.Code, http.StatusOK, getResponse.Body.String())
	}

	listResponse := httptest.NewRecorder()
	router.ServeHTTP(listResponse, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/accounts", nil))
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d; body = %s", listResponse.Code, http.StatusOK, listResponse.Body.String())
	}
	var listed generated.AccountListResponse
	if err := json.NewDecoder(listResponse.Body).Decode(&listed); err != nil {
		t.Fatalf("decode account list: %v", err)
	}
	if !containsAccount(listed.Accounts, accountID) {
		t.Fatalf("created account %s is missing from list", accountID)
	}

	duplicateBody := fmt.Sprintf(`{"name":%q,"type":"BROKERAGE","base_currency":"CAD"}`, strings.ToLower(name))
	duplicateResponse := serveAccountJSON(t, router, http.MethodPost, "/api/portfolios/"+portfolioID.String()+"/accounts", duplicateBody)
	if duplicateResponse.Code != http.StatusConflict {
		t.Fatalf("duplicate status = %d, want %d", duplicateResponse.Code, http.StatusConflict)
	}
	assertErrorCode(t, duplicateResponse, "account_name_conflict")

	missingResponse := httptest.NewRecorder()
	router.ServeHTTP(missingResponse, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+portfolioID.String()+"/accounts/"+uuid.NewString(), nil))
	if missingResponse.Code != http.StatusNotFound {
		t.Fatalf("missing status = %d, want %d", missingResponse.Code, http.StatusNotFound)
	}
	assertErrorCode(t, missingResponse, "account_not_found")
}

func TestAccountHTTPRejectsNonDefaultPortfolio(t *testing.T) {
	pool := httpAccountTestPool(t)
	ctx := context.Background()
	bootstrapResult, err := bootstrap.NewService(bootstrap.NewPostgresRepository(pool)).BootstrapLocal(ctx)
	if err != nil {
		t.Fatalf("BootstrapLocal() error = %v", err)
	}
	otherPortfolioID := insertHTTPTestPortfolio(t, ctx, pool, bootstrapResult.Workspace.ID)
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `delete from portfolios where id = $1`, otherPortfolioID); err != nil {
			t.Fatalf("delete HTTP test portfolio: %v", err)
		}
	})

	router := NewRouter(Options{
		DeploymentMode: config.DeploymentModeLocal,
		LocalContext:   localcontext.NewService(localcontext.NewPostgresRepository(pool)),
		Accounts:       account.New(database.New(pool)),
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/portfolios/"+otherPortfolioID.String()+"/accounts", nil))

	if response.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
	}
	assertErrorCode(t, response, "portfolio_not_found")
}

func serveAccountJSON(t *testing.T, router http.Handler, method string, path string, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func containsAccount(accounts []generated.Account, id uuid.UUID) bool {
	for _, candidate := range accounts {
		if uuid.UUID(candidate.Id) == id {
			return true
		}
	}
	return false
}

func httpAccountTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("FINSIGHT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("FINSIGHT_TEST_DATABASE_URL is required for account HTTP integration tests")
	}
	ctx := context.Background()
	if err := postgres.RunMigrations(ctx, databaseURL, migrations.Files); err != nil {
		t.Fatalf("RunMigrations() error = %v", err)
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("pgxpool.New() error = %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func insertHTTPTestPortfolio(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
insert into portfolios (workspace_id, name, base_currency, is_default)
values ($1, $2, 'CAD', false)
returning id
`, workspaceID, "HTTP Test Portfolio "+uuid.NewString()).Scan(&id)
	if err != nil {
		t.Fatalf("insert portfolio: %v", err)
	}
	return id
}
