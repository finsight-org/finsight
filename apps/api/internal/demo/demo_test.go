package demo

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/transaction"
)

func TestSeederReplacesDemoDataBeforeCreatingRecords(t *testing.T) {
	workspaceID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	portfolioID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	repository := &fakeRepository{}
	assets := &fakeAssetRegistry{}
	transactions := &fakeTransactionRecorder{}
	seeder := NewSeeder(
		assets,
		transactions,
		repository,
	)

	if err := seeder.Seed(context.Background(), workspaceID, portfolioID); err != nil {
		t.Fatalf("Seed() error = %v", err)
	}
	if repository.deletedWorkspaceID != workspaceID {
		t.Fatalf("deleted workspace id = %s, want %s", repository.deletedWorkspaceID, workspaceID)
	}
	if repository.deletedPortfolioID != portfolioID {
		t.Fatalf("deleted portfolio id = %s, want %s", repository.deletedPortfolioID, portfolioID)
	}
	if repository.deletedAfterRecords != 0 {
		t.Fatalf("records before delete = %d, want 0", repository.deletedAfterRecords)
	}
	if repository.accountCount != 2 {
		t.Fatalf("account count = %d, want 2", repository.accountCount)
	}
	if repository.priceCount != 18 {
		t.Fatalf("price count = %d, want 18", repository.priceCount)
	}
	if repository.fxRateCount != 7 {
		t.Fatalf("fx rate count = %d, want 7", repository.fxRateCount)
	}
	if transactions.count != 8 {
		t.Fatalf("transaction count = %d, want 8", transactions.count)
	}
	if len(assets.workspaceIDs) != 5 {
		t.Fatalf("asset workspace ID count = %d, want 5", len(assets.workspaceIDs))
	}
	for _, assetWorkspaceID := range assets.workspaceIDs {
		if assetWorkspaceID != workspaceID {
			t.Fatalf("asset workspace id = %s, want %s", assetWorkspaceID, workspaceID)
		}
	}
	for index := range transactions.portfolioIDs {
		if transactions.portfolioIDs[index] != portfolioID {
			t.Fatalf("transaction %d portfolio id = %s, want %s", index, transactions.portfolioIDs[index], portfolioID)
		}
	}
}

type fakeAssetRegistry struct {
	workspaceIDs []uuid.UUID
}

func (r *fakeAssetRegistry) UpsertAsset(_ context.Context, workspaceID uuid.UUID, input asset.UpsertInput) (asset.Asset, error) {
	r.workspaceIDs = append(r.workspaceIDs, workspaceID)
	ids := map[string]uuid.UUID{
		"finsight-demo:cash-cad": uuid.MustParse("33333333-3333-3333-3333-333333333333"),
		"finsight-demo:cash-usd": uuid.MustParse("44444444-4444-4444-4444-444444444444"),
		"finsight-demo:xeqt":     uuid.MustParse("55555555-5555-5555-5555-555555555555"),
		"finsight-demo:vfv":      uuid.MustParse("66666666-6666-6666-6666-666666666666"),
		"finsight-demo:voo":      uuid.MustParse("77777777-7777-7777-7777-777777777777"),
	}
	return asset.Asset{ID: ids[input.ProviderSymbol]}, nil
}

type fakeRepository struct {
	deletedWorkspaceID  uuid.UUID
	deletedPortfolioID  uuid.UUID
	deletedAfterRecords int
	accountCount        int
	priceCount          int
	fxRateCount         int
}

func (r *fakeRepository) DeleteDemoData(_ context.Context, workspaceID uuid.UUID, portfolioID uuid.UUID) error {
	r.deletedWorkspaceID = workspaceID
	r.deletedPortfolioID = portfolioID
	r.deletedAfterRecords = r.accountCount + r.priceCount
	return nil
}

func (r *fakeRepository) UpsertDemoAccount(_ context.Context, _ upsertAccountInput) (uuid.UUID, error) {
	r.accountCount++
	return uuid.New(), nil
}

func (r *fakeRepository) UpsertMarketPrice(context.Context, upsertMarketPriceInput) error {
	r.priceCount++
	return nil
}

func (r *fakeRepository) UpsertFXRate(context.Context, upsertFXRateInput) error {
	r.fxRateCount++
	return nil
}

type fakeTransactionRecorder struct {
	count        int
	portfolioIDs []uuid.UUID
}

func (r *fakeTransactionRecorder) RecordTransaction(_ context.Context, portfolioID uuid.UUID, input transaction.CreateInput) (transaction.Transaction, error) {
	r.count++
	r.portfolioIDs = append(r.portfolioIDs, portfolioID)
	return transaction.Transaction{ExternalID: input.ExternalID}, nil
}
