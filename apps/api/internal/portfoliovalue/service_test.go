package portfoliovalue

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

func TestGetOverviewCalculatesCashAndPricedAssetValue(t *testing.T) {
	accountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	assetID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	service := NewServiceWithClock(fakeBootstrapper{portfolioID: uuid.New()}, fakeRepository{
		data: valuationData{
			Accounts: []valuationAccount{{ID: accountID, Name: "TFSA"}},
			Entries: []valuationEntry{
				cashEntry(accountID, "CAD Cash", "500"),
				assetEntry(accountID, assetID, "XEQT", "10"),
			},
			Prices: []marketPrice{{AssetID: assetID, Date: date("2026-07-01"), Price: decimal.RequireFromString("42"), Currency: "CAD"}},
		},
	}, fixedClock("2026-07-07"))

	overview, err := service.GetOverview(context.Background())
	if err != nil {
		t.Fatalf("GetOverview() error = %v", err)
	}
	if !overview.TotalValue.Equal(decimal.RequireFromString("920")) {
		t.Fatalf("total value = %s, want 920", overview.TotalValue)
	}
	if len(overview.Warnings) != 0 {
		t.Fatalf("warnings = %#v, want none", overview.Warnings)
	}
}

func TestGetOverviewWarnsAndExcludesMissingPrice(t *testing.T) {
	accountID := uuid.New()
	assetID := uuid.New()
	service := NewServiceWithClock(fakeBootstrapper{portfolioID: uuid.New()}, fakeRepository{
		data: valuationData{
			Accounts: []valuationAccount{{ID: accountID, Name: "TFSA"}},
			Entries:  []valuationEntry{assetEntry(accountID, assetID, "XEQT", "10")},
		},
	}, fixedClock("2026-07-07"))

	overview, err := service.GetOverview(context.Background())
	if err != nil {
		t.Fatalf("GetOverview() error = %v", err)
	}
	if !overview.TotalValue.IsZero() {
		t.Fatalf("total value = %s, want 0", overview.TotalValue)
	}
	if len(overview.Warnings) != 1 || overview.Warnings[0].Code != "missing_price" {
		t.Fatalf("warnings = %#v, want missing_price", overview.Warnings)
	}
}

func TestGetOverviewWarnsAndExcludesNonCADRecords(t *testing.T) {
	accountID := uuid.New()
	service := NewServiceWithClock(fakeBootstrapper{portfolioID: uuid.New()}, fakeRepository{
		data: valuationData{
			Accounts: []valuationAccount{{ID: accountID, Name: "TFSA"}},
			Entries: []valuationEntry{{
				AccountID:     accountID,
				AccountName:   "TFSA",
				AssetID:       uuid.New(),
				AssetName:     "USD Cash",
				AssetCurrency: "USD",
				EntryType:     "CASH",
				Amount:        decimal.RequireFromString("100"),
				EntryCurrency: "USD",
				TradeDate:     date("2026-07-01"),
			}},
		},
	}, fixedClock("2026-07-07"))

	overview, err := service.GetOverview(context.Background())
	if err != nil {
		t.Fatalf("GetOverview() error = %v", err)
	}
	if !overview.TotalValue.IsZero() {
		t.Fatalf("total value = %s, want 0", overview.TotalValue)
	}
	if len(overview.Warnings) != 1 || overview.Warnings[0].Code != "unsupported_currency" {
		t.Fatalf("warnings = %#v, want unsupported_currency", overview.Warnings)
	}
}

func TestGetValueHistoryReturnsDailyPoints(t *testing.T) {
	accountID := uuid.New()
	service := NewServiceWithClock(fakeBootstrapper{portfolioID: uuid.New()}, fakeRepository{
		data: valuationData{
			Accounts: []valuationAccount{{ID: accountID, Name: "TFSA"}},
			Entries:  []valuationEntry{cashEntryOn(accountID, "CAD Cash", "100", "2026-07-05")},
		},
	}, fixedClock("2026-07-07"))

	history, err := service.GetValueHistory(context.Background(), portfolio.RangeOneWeek)
	if err != nil {
		t.Fatalf("GetValueHistory() error = %v", err)
	}
	if len(history.Points) != 7 {
		t.Fatalf("points length = %d, want 7", len(history.Points))
	}
	if !history.Points[0].Value.IsZero() {
		t.Fatalf("first point value = %s, want 0", history.Points[0].Value)
	}
	if !history.Points[6].Value.Equal(decimal.RequireFromString("100")) {
		t.Fatalf("last point value = %s, want 100", history.Points[6].Value)
	}
}

func TestGetAccountValuesCalculatesAllocationPercent(t *testing.T) {
	firstAccountID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	secondAccountID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	service := NewServiceWithClock(fakeBootstrapper{portfolioID: uuid.New()}, fakeRepository{
		data: valuationData{
			Accounts: []valuationAccount{
				{ID: firstAccountID, Name: "First"},
				{ID: secondAccountID, Name: "Second"},
			},
			Entries: []valuationEntry{
				cashEntryForAccount(firstAccountID, "First", "CAD Cash", "25"),
				cashEntryForAccount(secondAccountID, "Second", "CAD Cash", "75"),
			},
		},
	}, fixedClock("2026-07-07"))

	values, err := service.GetAccountValues(context.Background())
	if err != nil {
		t.Fatalf("GetAccountValues() error = %v", err)
	}
	if len(values.Accounts) != 2 {
		t.Fatalf("accounts length = %d, want 2", len(values.Accounts))
	}
	if !values.Accounts[0].AllocationPercent.Equal(decimal.RequireFromString("25")) {
		t.Fatalf("first allocation = %s, want 25", values.Accounts[0].AllocationPercent)
	}
	if !values.Accounts[1].AllocationPercent.Equal(decimal.RequireFromString("75")) {
		t.Fatalf("second allocation = %s, want 75", values.Accounts[1].AllocationPercent)
	}
}

func TestGetValueHistoryRejectsInvalidRange(t *testing.T) {
	service := NewServiceWithClock(fakeBootstrapper{portfolioID: uuid.New()}, fakeRepository{}, fixedClock("2026-07-07"))
	_, err := service.GetValueHistory(context.Background(), portfolio.Range("BAD"))
	if !errors.Is(err, portfolio.ErrInvalidRange) {
		t.Fatalf("GetValueHistory() error = %v, want %v", err, portfolio.ErrInvalidRange)
	}
}

type fakeBootstrapper struct {
	portfolioID uuid.UUID
}

func (b fakeBootstrapper) BootstrapLocal(context.Context) (bootstrap.Result, error) {
	return bootstrap.Result{Portfolio: portfolio.Portfolio{ID: b.portfolioID}}, nil
}

type fakeRepository struct {
	data valuationData
}

func (r fakeRepository) LoadValuationData(context.Context, uuid.UUID, time.Time) (valuationData, error) {
	return r.data, nil
}

func cashEntry(accountID uuid.UUID, assetName string, amount string) valuationEntry {
	return cashEntryForAccountOn(accountID, "TFSA", assetName, amount, "2026-07-01")
}

func cashEntryOn(accountID uuid.UUID, assetName string, amount string, tradeDate string) valuationEntry {
	return cashEntryForAccountOn(accountID, "TFSA", assetName, amount, tradeDate)
}

func cashEntryForAccount(accountID uuid.UUID, accountName string, assetName string, amount string) valuationEntry {
	return cashEntryForAccountOn(accountID, accountName, assetName, amount, "2026-07-01")
}

func cashEntryForAccountOn(accountID uuid.UUID, accountName string, assetName string, amount string, tradeDate string) valuationEntry {
	return valuationEntry{
		AccountID:     accountID,
		AccountName:   accountName,
		AssetID:       uuid.New(),
		AssetName:     assetName,
		AssetCurrency: "CAD",
		EntryType:     "CASH",
		Amount:        decimal.RequireFromString(amount),
		EntryCurrency: "CAD",
		TradeDate:     date(tradeDate),
	}
}

func assetEntry(accountID uuid.UUID, assetID uuid.UUID, assetName string, quantity string) valuationEntry {
	return valuationEntry{
		AccountID:     accountID,
		AccountName:   "TFSA",
		AssetID:       assetID,
		AssetName:     assetName,
		AssetCurrency: "CAD",
		EntryType:     "ASSET_QUANTITY",
		Quantity:      decimal.RequireFromString(quantity),
		EntryCurrency: "CAD",
		TradeDate:     date("2026-07-01"),
	}
}

func fixedClock(value string) func() time.Time {
	return func() time.Time {
		return date(value)
	}
}

func date(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}
