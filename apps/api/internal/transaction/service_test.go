package transaction

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func TestRecordTransactionPassesPortfolioContext(t *testing.T) {
	portfolioID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	accountID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	assetID := uuid.MustParse("66666666-6666-6666-6666-666666666666")
	repository := &fakeTransactionRepository{}
	service := NewService(repository)

	_, err := service.RecordTransaction(context.Background(), portfolioID, CreateInput{
		AccountID:   accountID,
		Type:        TypeOpeningBalance,
		TradeDate:   time.Date(2026, 7, 8, 14, 30, 0, 0, time.FixedZone("EDT", -4*60*60)),
		Description: "  Opening balance  ",
		Source:      " demo ",
		LedgerEntries: []CreateLedgerEntryInput{
			{
				AssetID:   assetID,
				EntryType: EntryTypeCash,
				Amount:    decimal.NewFromInt(1000),
				Currency:  "CAD",
				Direction: DirectionIncrease,
			},
		},
	})
	if err != nil {
		t.Fatalf("RecordTransaction() error = %v", err)
	}

	if repository.input.PortfolioID != portfolioID {
		t.Fatalf("portfolio id = %s, want %s", repository.input.PortfolioID, portfolioID)
	}
	if repository.input.AccountID != accountID {
		t.Fatalf("account id = %s, want %s", repository.input.AccountID, accountID)
	}
	if repository.input.TradeDate != time.Date(2026, 7, 8, 0, 0, 0, 0, time.UTC) {
		t.Fatalf("trade date = %s, want 2026-07-08 UTC", repository.input.TradeDate)
	}
	if repository.input.Source != "DEMO" {
		t.Fatalf("source = %q, want DEMO", repository.input.Source)
	}
}

type fakeTransactionRepository struct {
	input createRepositoryInput
	err   error
}

func (r *fakeTransactionRepository) CreateWithEntries(_ context.Context, input createRepositoryInput) (Transaction, error) {
	r.input = input
	if r.err != nil {
		return Transaction{}, r.err
	}
	return Transaction{
		ID:          uuid.New(),
		PortfolioID: input.PortfolioID,
		AccountID:   input.AccountID,
		Type:        input.Type,
		TradeDate:   input.TradeDate,
		Source:      input.Source,
		Status:      StatusConfirmed,
	}, nil
}
