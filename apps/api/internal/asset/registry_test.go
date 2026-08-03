package asset

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestUpsertAssetRoutesCashThroughCashRepositoryPath(t *testing.T) {
	workspaceID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	repository := &fakeRegistryRepository{}
	registry := NewRegistry(repository)

	created, err := registry.UpsertAsset(context.Background(), workspaceID, UpsertInput{
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
	if !repository.upsertCashCalled {
		t.Fatal("UpsertCash called = false, want true")
	}
	if repository.upsertCalled {
		t.Fatal("Upsert called = true, want false")
	}
	if repository.input.WorkspaceID != workspaceID {
		t.Fatalf("workspace id = %s, want %s", repository.input.WorkspaceID, workspaceID)
	}
	if created.Type != TypeCash {
		t.Fatalf("created type = %q, want %q", created.Type, TypeCash)
	}
}

func TestUpsertAssetRoutesNonCashThroughProviderRepositoryPath(t *testing.T) {
	repository := &fakeRegistryRepository{}
	registry := NewRegistry(repository)

	_, err := registry.UpsertAsset(context.Background(), uuid.New(), UpsertInput{
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
	if repository.upsertCashCalled {
		t.Fatal("UpsertCash called = true, want false")
	}
}

type fakeRegistryRepository struct {
	input            upsertRepositoryInput
	upsertCalled     bool
	upsertCashCalled bool
	err              error
}

func (r *fakeRegistryRepository) Upsert(_ context.Context, input upsertRepositoryInput) (Asset, error) {
	r.input = input
	r.upsertCalled = true
	if r.err != nil {
		return Asset{}, r.err
	}
	return Asset{ID: uuid.New(), WorkspaceID: input.WorkspaceID, Name: input.Name, Type: input.Type, Currency: input.Currency, Symbol: input.Symbol, ProviderID: input.ProviderID, ProviderSymbol: input.ProviderSymbol}, nil
}

func (r *fakeRegistryRepository) UpsertCash(_ context.Context, input upsertRepositoryInput) (Asset, error) {
	r.input = input
	r.upsertCashCalled = true
	if r.err != nil {
		return Asset{}, r.err
	}
	return Asset{ID: uuid.New(), WorkspaceID: input.WorkspaceID, Name: input.Name, Type: input.Type, Currency: input.Currency, Symbol: input.Symbol, ProviderID: input.ProviderID, ProviderSymbol: input.ProviderSymbol}, nil
}
