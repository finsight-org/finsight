package account

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/migrations"
)

func TestStoreCreateListAndGet(t *testing.T) {
	pool := accountTestPool(t)
	ctx := context.Background()
	workspaceID := insertAccountTestWorkspace(t, ctx, pool)
	t.Cleanup(func() { deleteAccountTestWorkspace(t, ctx, pool, workspaceID) })
	portfolioID := insertAccountTestPortfolio(t, ctx, pool, workspaceID)
	otherPortfolioID := insertAccountTestPortfolio(t, ctx, pool, workspaceID)
	store := New(database.New(pool))

	institution := "Questrade"
	externalReference := "margin-1"
	margin, err := store.Create(ctx, CreateParams{
		PortfolioID:       portfolioID,
		Name:              "Margin",
		InstitutionName:   &institution,
		Type:              "BROKERAGE",
		BaseCurrency:      "CAD",
		ExternalReference: &externalReference,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if margin.Name != "Margin" || margin.Type != "BROKERAGE" || margin.BaseCurrency != "CAD" {
		t.Fatalf("created account = %#v", margin)
	}
	if !margin.InstitutionName.Valid || margin.InstitutionName.String != institution {
		t.Fatalf("institution name = %#v, want %q", margin.InstitutionName, institution)
	}
	if !margin.ExternalReference.Valid || margin.ExternalReference.String != externalReference {
		t.Fatalf("external reference = %#v, want %q", margin.ExternalReference, externalReference)
	}

	_, err = store.Create(ctx, validCreateParams(portfolioID, "Bank"))
	if err != nil {
		t.Fatalf("Create(Bank) error = %v", err)
	}

	accounts, err := store.List(ctx, portfolioID)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(accounts) != 2 || accounts[0].Name != "Bank" || accounts[1].Name != "Margin" {
		t.Fatalf("List() = %#v, want Bank then Margin", accounts)
	}

	found, err := store.Get(ctx, portfolioID, uuid.UUID(margin.ID.Bytes))
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if found.ID != margin.ID {
		t.Fatalf("Get() id = %v, want %v", found.ID, margin.ID)
	}

	_, err = store.Get(ctx, otherPortfolioID, uuid.UUID(margin.ID.Bytes))
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get(other portfolio) error = %v, want %v", err, ErrNotFound)
	}
}

func TestStoreTranslatesDatabaseConstraints(t *testing.T) {
	pool := accountTestPool(t)
	ctx := context.Background()
	workspaceID := insertAccountTestWorkspace(t, ctx, pool)
	t.Cleanup(func() { deleteAccountTestWorkspace(t, ctx, pool, workspaceID) })
	portfolioID := insertAccountTestPortfolio(t, ctx, pool, workspaceID)
	store := New(database.New(pool))

	empty := ""
	leadingWhitespace := " Questrade"
	trailingWhitespace := "reference "
	tests := []struct {
		name   string
		params CreateParams
	}{
		{name: "empty name", params: validCreateParams(portfolioID, "")},
		{name: "leading name whitespace", params: validCreateParams(portfolioID, " Margin")},
		{name: "trailing name whitespace", params: validCreateParams(portfolioID, "Margin ")},
		{name: "empty institution", params: withInstitution(validCreateParams(portfolioID, "Institution empty"), &empty)},
		{name: "institution whitespace", params: withInstitution(validCreateParams(portfolioID, "Institution whitespace"), &leadingWhitespace)},
		{name: "empty external reference", params: withExternalReference(validCreateParams(portfolioID, "Reference empty"), &empty)},
		{name: "external reference whitespace", params: withExternalReference(validCreateParams(portfolioID, "Reference whitespace"), &trailingWhitespace)},
		{name: "invalid type", params: withType(validCreateParams(portfolioID, "Invalid type"), "OTHER")},
		{name: "invalid currency", params: withCurrency(validCreateParams(portfolioID, "Invalid currency"), "cad")},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := store.Create(ctx, test.params)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("Create() error = %v, want %v", err, ErrInvalidInput)
			}
		})
	}
}

func TestStoreTranslatesDuplicateName(t *testing.T) {
	pool := accountTestPool(t)
	ctx := context.Background()
	workspaceID := insertAccountTestWorkspace(t, ctx, pool)
	t.Cleanup(func() { deleteAccountTestWorkspace(t, ctx, pool, workspaceID) })
	portfolioID := insertAccountTestPortfolio(t, ctx, pool, workspaceID)
	store := New(database.New(pool))

	if _, err := store.Create(ctx, validCreateParams(portfolioID, "Margin")); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	_, err := store.Create(ctx, validCreateParams(portfolioID, "margin"))
	if !errors.Is(err, ErrDuplicateName) {
		t.Fatalf("Create(duplicate) error = %v, want %v", err, ErrDuplicateName)
	}
}

func validCreateParams(portfolioID uuid.UUID, name string) CreateParams {
	return CreateParams{
		PortfolioID:  portfolioID,
		Name:         name,
		Type:         "BROKERAGE",
		BaseCurrency: "CAD",
	}
}

func withInstitution(params CreateParams, value *string) CreateParams {
	params.InstitutionName = value
	return params
}

func withExternalReference(params CreateParams, value *string) CreateParams {
	params.ExternalReference = value
	return params
}

func withType(params CreateParams, value string) CreateParams {
	params.Type = value
	return params
}

func withCurrency(params CreateParams, value string) CreateParams {
	params.BaseCurrency = value
	return params
}

func accountTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("FINSIGHT_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("FINSIGHT_TEST_DATABASE_URL is required for account integration tests")
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

func insertAccountTestWorkspace(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
insert into workspaces (name, base_currency, auth_mode)
values ($1, 'CAD', $2)
returning id
`, "Account Test Workspace "+uuid.NewString(), "test-"+uuid.NewString()).Scan(&id)
	if err != nil {
		t.Fatalf("insert workspace: %v", err)
	}
	return id
}

func insertAccountTestPortfolio(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
insert into portfolios (workspace_id, name, base_currency, is_default)
values ($1, $2, 'CAD', false)
returning id
`, workspaceID, "Account Test Portfolio "+uuid.NewString()).Scan(&id)
	if err != nil {
		t.Fatalf("insert portfolio: %v", err)
	}
	return id
}

func deleteAccountTestWorkspace(t *testing.T, ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(ctx, `delete from workspaces where id = $1`, workspaceID); err != nil {
		t.Fatalf("delete workspace: %v", err)
	}
}
