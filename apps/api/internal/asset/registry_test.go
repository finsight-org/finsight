package asset

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/identity"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

func TestUpsertAssetRoutesCashThroughCashRepositoryPath(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	repository := &fakeRegistryRepository{}
	registry := NewRegistry(fakeRegistryBootstrapper{result: registryBootstrapResult(workspaceID)}, repository)

	created, err := registry.UpsertAsset(context.Background(), UpsertInput{
		Name:           "Canadian Dollar",
		Type:           TypeCash,
		Currency:       "CAD",
		Symbol:         "CAD",
		ProviderID:     "demo",
		ProviderSymbol: "cash:cad",
	})
	if err != nil {
		t.Fatalf("UpsertAsset() error = %v", err)
	}
	if !repository.upsertCalled {
		t.Fatal("Upsert called = false, want true")
	}
	if repository.workspaceID != workspaceID {
		t.Fatalf("workspace id = %s, want %s", repository.workspaceID, workspaceID)
	}
	if created.Type != TypeCash {
		t.Fatalf("created type = %q, want %q", created.Type, TypeCash)
	}
}

func TestUpsertAssetRoutesNonCashThroughProviderRepositoryPath(t *testing.T) {
	repository := &fakeRegistryRepository{}
	registry := NewRegistry(fakeRegistryBootstrapper{result: registryBootstrapResult(uuid.New())}, repository)

	_, err := registry.UpsertAsset(context.Background(), UpsertInput{
		Name:           "iShares Core Equity ETF",
		Type:           TypeETF,
		Currency:       "CAD",
		Symbol:         "XEQT",
		ProviderID:     "demo",
		ProviderSymbol: "xeqt.to",
	})
	if err != nil {
		t.Fatalf("UpsertAsset() error = %v", err)
	}
	if !repository.upsertCalled {
		t.Fatal("Upsert called = false, want true")
	}
}

type fakeRegistryBootstrapper struct {
	result bootstrap.Result
	err    error
}

func (b fakeRegistryBootstrapper) BootstrapLocal(context.Context) (bootstrap.Result, error) {
	return b.result, b.err
}

type fakeRegistryRepository struct {
	workspaceID  uuid.UUID
	input        UpsertInput
	upsertCalled bool
	err          error
}

func (r *fakeRegistryRepository) Upsert(_ context.Context, workspaceID uuid.UUID, input UpsertInput) (Asset, error) {
	r.workspaceID = workspaceID
	r.input = input
	r.upsertCalled = true
	if r.err != nil {
		return Asset{}, r.err
	}
	return Asset{ID: uuid.New(), WorkspaceID: workspaceID, Name: input.Name, Type: input.Type, Currency: input.Currency, Symbol: input.Symbol, ProviderID: input.ProviderID, ProviderSymbol: input.ProviderSymbol}, nil
}

func registryBootstrapResult(workspaceID uuid.UUID) bootstrap.Result {
	return bootstrap.Result{
		User: identity.User{ID: uuid.New(), Email: "local@finsight.local", DisplayName: "Local User"},
		Workspace: identity.Workspace{
			ID:           workspaceID,
			Name:         "Local Workspace",
			BaseCurrency: "CAD",
			AuthMode:     "local",
		},
		Portfolio: portfolio.Portfolio{
			ID:           uuid.New(),
			WorkspaceID:  workspaceID,
			Name:         "Default Portfolio",
			BaseCurrency: "CAD",
			IsDefault:    true,
		},
	}
}
