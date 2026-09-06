package portfoliovalue

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

func TestCalculateOverviewValuesCashAndPricedAssets(t *testing.T) {
	accountID := uuid.New()
	assetID := uuid.New()
	data := valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries: []valuationEntry{
			cashEntry(accountID, "CAD Cash", "500"),
			assetEntry(accountID, assetID, "XEQT", "10", "CAD"),
		},
		Prices: []marketPrice{{AssetID: assetID, Date: testDate("2026-07-01"), Price: decimal.RequireFromString("42"), Currency: "CAD"}},
	}

	overview := calculateOverview(data, testDate("2026-07-07"))
	if !overview.TotalValue.Equal(decimal.RequireFromString("920")) {
		t.Fatalf("total value = %s, want 920", overview.TotalValue)
	}
	if len(overview.Warnings) != 0 {
		t.Fatalf("warnings = %#v, want none", overview.Warnings)
	}
}

func TestCalculateOverviewConvertsForeignCurrency(t *testing.T) {
	accountID := uuid.New()
	assetID := uuid.New()
	data := valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries: []valuationEntry{
			cashEntryWithCurrency(accountID, "USD Cash", "100", "USD"),
			assetEntry(accountID, assetID, "VOO", "10", "USD"),
		},
		Prices:  []marketPrice{{AssetID: assetID, Date: testDate("2026-07-01"), Price: decimal.RequireFromString("20"), Currency: "USD"}},
		FXRates: []fxRate{fxRateOn("USD", "CAD", "2026-07-01", "1.35")},
	}

	overview := calculateOverview(data, testDate("2026-07-07"))
	if !overview.TotalValue.Equal(decimal.RequireFromString("405")) {
		t.Fatalf("total value = %s, want 405", overview.TotalValue)
	}
}

func TestCalculateOverviewWarnsForMissingInputs(t *testing.T) {
	accountID := uuid.New()
	assetID := uuid.New()
	data := valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries: []valuationEntry{
			cashEntryWithCurrency(accountID, "USD Cash", "100", "USD"),
			assetEntry(accountID, assetID, "XEQT", "1", "CAD"),
		},
	}

	overview := calculateOverview(data, testDate("2026-07-07"))
	if !overview.TotalValue.IsZero() {
		t.Fatalf("total value = %s, want 0", overview.TotalValue)
	}
	if len(overview.Warnings) != 2 {
		t.Fatalf("warnings = %#v, want missing price and FX warnings", overview.Warnings)
	}
}

func TestCalculateAccountValuesAllocatesAfterConversion(t *testing.T) {
	firstID := uuid.New()
	secondID := uuid.New()
	data := valuationData{
		BaseCurrency: "CAD",
		Accounts: []valuationAccount{
			{ID: firstID, Name: "First"},
			{ID: secondID, Name: "Second"},
		},
		Entries: []valuationEntry{
			cashEntryForAccount(firstID, "First", "CAD Cash", "100", "CAD", "2026-07-01"),
			cashEntryForAccount(secondID, "Second", "USD Cash", "100", "USD", "2026-07-01"),
		},
		FXRates: []fxRate{fxRateOn("USD", "CAD", "2026-07-01", "1.50")},
	}

	values := calculateAccountValues(data, testDate("2026-07-07"))
	if len(values.Accounts) != 2 {
		t.Fatalf("accounts length = %d, want 2", len(values.Accounts))
	}
	if !values.Accounts[0].AllocationPercent.Equal(decimal.RequireFromString("40")) ||
		!values.Accounts[1].AllocationPercent.Equal(decimal.RequireFromString("60")) {
		t.Fatalf("allocations = %s/%s, want 40/60", values.Accounts[0].AllocationPercent, values.Accounts[1].AllocationPercent)
	}
}

func TestCalculateValueHistoryUsesHistoricalRates(t *testing.T) {
	accountID := uuid.New()
	data := valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries:      []valuationEntry{cashEntryForAccount(accountID, "TFSA", "USD Cash", "100", "USD", "2026-07-05")},
		FXRates: []fxRate{
			fxRateOn("USD", "CAD", "2026-07-04", "1.30"),
			fxRateOn("USD", "CAD", "2026-07-06", "1.40"),
		},
	}

	history := calculateValueHistory(data, testDate("2026-07-07"), portfolio.RangeOneWeek)
	if len(history.Points) != 7 {
		t.Fatalf("points length = %d, want 7", len(history.Points))
	}
	if !history.Points[4].Value.Equal(decimal.RequireFromString("130")) || !history.Points[6].Value.Equal(decimal.RequireFromString("140")) {
		t.Fatalf("historical values = %s/%s, want 130/140", history.Points[4].Value, history.Points[6].Value)
	}
}

func TestCalculatorRejectsInvalidRangeBeforeLoading(t *testing.T) {
	_, err := (*Calculator)(nil).GetValueHistory(context.Background(), uuid.New(), portfolio.Range("BAD"))
	if !errors.Is(err, portfolio.ErrInvalidRange) {
		t.Fatalf("GetValueHistory() error = %v, want %v", err, portfolio.ErrInvalidRange)
	}
}

func cashEntry(accountID uuid.UUID, assetName string, amount string) valuationEntry {
	return cashEntryForAccount(accountID, "TFSA", assetName, amount, "CAD", "2026-07-01")
}

func cashEntryWithCurrency(accountID uuid.UUID, assetName string, amount string, currency string) valuationEntry {
	return cashEntryForAccount(accountID, "TFSA", assetName, amount, currency, "2026-07-01")
}

func cashEntryForAccount(accountID uuid.UUID, accountName string, assetName string, amount string, currency string, tradeDate string) valuationEntry {
	return valuationEntry{
		AccountID:     accountID,
		AccountName:   accountName,
		AssetID:       uuid.New(),
		AssetName:     assetName,
		AssetCurrency: currency,
		EntryType:     "CASH",
		Amount:        decimal.RequireFromString(amount),
		EntryCurrency: currency,
		TradeDate:     testDate(tradeDate),
	}
}

func assetEntry(accountID uuid.UUID, assetID uuid.UUID, assetName string, quantity string, currency string) valuationEntry {
	return valuationEntry{
		AccountID:     accountID,
		AccountName:   "TFSA",
		AssetID:       assetID,
		AssetName:     assetName,
		AssetCurrency: currency,
		EntryType:     "ASSET_QUANTITY",
		Quantity:      decimal.RequireFromString(quantity),
		EntryCurrency: currency,
		TradeDate:     testDate("2026-07-01"),
	}
}

func fxRateOn(fromCurrency string, toCurrency string, rateDate string, rate string) fxRate {
	return fxRate{
		FromCurrency:  fromCurrency,
		ToCurrency:    toCurrency,
		Date:          testDate(rateDate),
		Rate:          decimal.RequireFromString(rate),
		ProviderID:    "demo",
		SourceQuality: "DEMO",
	}
}

func testDate(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}
