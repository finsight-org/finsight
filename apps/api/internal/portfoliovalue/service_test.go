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

func TestCalculateOverviewCalculatesCashAndPricedAssetValue(t *testing.T) {
	accountID := uuid.New()
	assetID := uuid.New()
	overview := calculateOverview(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries: []valuationEntry{
			cashEntry(accountID, "CAD Cash", "500"),
			assetEntry(accountID, assetID, "XEQT", "10"),
		},
		Prices: []marketPrice{{AssetID: assetID, Date: date("2026-07-01"), Price: decimal.RequireFromString("42"), Currency: "CAD"}},
	}, date("2026-07-07"))

	if !overview.TotalValue.Equal(decimal.RequireFromString("920")) {
		t.Fatalf("total value = %s, want 920", overview.TotalValue)
	}
	if len(overview.Warnings) != 0 {
		t.Fatalf("warnings = %#v, want none", overview.Warnings)
	}
}

func TestCalculateOverviewWarnsAndExcludesMissingPrice(t *testing.T) {
	accountID := uuid.New()
	overview := calculateOverview(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries:      []valuationEntry{assetEntry(accountID, uuid.New(), "XEQT", "10")},
	}, date("2026-07-07"))

	if !overview.TotalValue.IsZero() {
		t.Fatalf("total value = %s, want 0", overview.TotalValue)
	}
	if len(overview.Warnings) != 1 || overview.Warnings[0].Code != "missing_price" {
		t.Fatalf("warnings = %#v, want missing_price", overview.Warnings)
	}
}

func TestCalculateOverviewUsesDeterministicSameDayPricePriority(t *testing.T) {
	accountID := uuid.New()
	assetID := uuid.New()
	overview := calculateOverview(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries:      []valuationEntry{assetEntry(accountID, assetID, "XEQT", "1")},
		Prices: []marketPrice{
			{AssetID: assetID, Date: date("2026-07-01"), Price: decimal.RequireFromString("50"), Currency: "CAD", ProviderID: "provider", SourceQuality: "PROVIDER"},
			{AssetID: assetID, Date: date("2026-07-01"), Price: decimal.RequireFromString("42"), Currency: "CAD", ProviderID: "demo", SourceQuality: "DEMO"},
		},
	}, date("2026-07-07"))

	if !overview.TotalValue.Equal(decimal.RequireFromString("42")) {
		t.Fatalf("total value = %s, want demo price 42", overview.TotalValue)
	}
}

func TestCalculateOverviewFallsBackToConvertiblePriceWhenPreferredPriceMissingFX(t *testing.T) {
	accountID := uuid.New()
	assetID := uuid.New()
	overview := calculateOverview(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries:      []valuationEntry{assetEntry(accountID, assetID, "XEQT", "1")},
		Prices: []marketPrice{
			{AssetID: assetID, Date: date("2026-07-01"), Price: decimal.RequireFromString("55"), Currency: "CAD", ProviderID: "provider", SourceQuality: "PROVIDER"},
			{AssetID: assetID, Date: date("2026-07-01"), Price: decimal.RequireFromString("50"), Currency: "USD", ProviderID: "demo", SourceQuality: "DEMO"},
		},
	}, date("2026-07-07"))

	if !overview.TotalValue.Equal(decimal.RequireFromString("55")) {
		t.Fatalf("total value = %s, want convertible CAD price 55", overview.TotalValue)
	}
	if len(overview.Warnings) != 0 {
		t.Fatalf("warnings = %#v, want none", overview.Warnings)
	}
}

func TestCalculateOverviewConvertsForeignCashToBaseCurrency(t *testing.T) {
	accountID := uuid.New()
	overview := calculateOverview(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries:      []valuationEntry{cashEntryWithCurrency(accountID, "USD Cash", "100", "USD")},
		FXRates:      []fxRate{fxRateOn("USD", "CAD", "2026-07-01", "1.35")},
	}, date("2026-07-07"))

	if !overview.TotalValue.Equal(decimal.RequireFromString("135")) {
		t.Fatalf("total value = %s, want 135", overview.TotalValue)
	}
	if len(overview.Warnings) != 0 {
		t.Fatalf("warnings = %#v, want none", overview.Warnings)
	}
}

func TestCalculateOverviewConvertsForeignPricedAssetToBaseCurrency(t *testing.T) {
	accountID := uuid.New()
	assetID := uuid.New()
	overview := calculateOverview(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries:      []valuationEntry{assetEntryWithCurrency(accountID, assetID, "VOO", "10", "USD")},
		Prices:       []marketPrice{{AssetID: assetID, Date: date("2026-07-01"), Price: decimal.RequireFromString("20"), Currency: "USD"}},
		FXRates:      []fxRate{fxRateOn("USD", "CAD", "2026-07-01", "1.35")},
	}, date("2026-07-07"))

	if !overview.TotalValue.Equal(decimal.RequireFromString("270")) {
		t.Fatalf("total value = %s, want 270", overview.TotalValue)
	}
	if len(overview.Warnings) != 0 {
		t.Fatalf("warnings = %#v, want none", overview.Warnings)
	}
}

func TestCalculateOverviewWarnsAndExcludesMissingFXRate(t *testing.T) {
	accountID := uuid.New()
	overview := calculateOverview(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries:      []valuationEntry{cashEntryWithCurrency(accountID, "USD Cash", "100", "USD")},
	}, date("2026-07-07"))

	if !overview.TotalValue.IsZero() {
		t.Fatalf("total value = %s, want 0", overview.TotalValue)
	}
	if len(overview.Warnings) != 1 || overview.Warnings[0].Code != "missing_fx_rate" {
		t.Fatalf("warnings = %#v, want missing_fx_rate", overview.Warnings)
	}
}

func TestCalculateValueHistoryReturnsDailyPoints(t *testing.T) {
	accountID := uuid.New()
	history := calculateValueHistory(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries:      []valuationEntry{cashEntryOn(accountID, "CAD Cash", "100", "2026-07-05")},
	}, portfolio.RangeOneWeek, date("2026-07-07"))

	if len(history.Points) != 7 {
		t.Fatalf("points length = %d, want 7", len(history.Points))
	}
	if !history.Points[0].Value.IsZero() || !history.Points[6].Value.Equal(decimal.RequireFromString("100")) {
		t.Fatalf("history values = %#v, want 0 then 100", history.Points)
	}
}

func TestCalculateValueHistoryUsesHistoricalFXRates(t *testing.T) {
	accountID := uuid.New()
	history := calculateValueHistory(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: accountID, Name: "TFSA"}},
		Entries:      []valuationEntry{cashEntryForAccountOnWithCurrency(accountID, "TFSA", "USD Cash", "100", "USD", "2026-07-05")},
		FXRates: []fxRate{
			fxRateOn("USD", "CAD", "2026-07-04", "1.30"),
			fxRateOn("USD", "CAD", "2026-07-06", "1.40"),
		},
	}, portfolio.RangeOneWeek, date("2026-07-07"))

	if len(history.Points) != 7 {
		t.Fatalf("points length = %d, want 7", len(history.Points))
	}
	if !history.Points[4].Value.Equal(decimal.RequireFromString("130")) || !history.Points[6].Value.Equal(decimal.RequireFromString("140")) {
		t.Fatalf("history values = %#v, want 130 then 140", history.Points)
	}
}

func TestCalculateAccountValuesCalculatesAllocationPercent(t *testing.T) {
	firstAccountID := uuid.New()
	secondAccountID := uuid.New()
	values := calculateAccountValues(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: firstAccountID, Name: "First"}, {ID: secondAccountID, Name: "Second"}},
		Entries: []valuationEntry{
			cashEntryForAccount(firstAccountID, "First", "CAD Cash", "25"),
			cashEntryForAccount(secondAccountID, "Second", "CAD Cash", "75"),
		},
	}, date("2026-07-07"))

	if !values.Accounts[0].AllocationPercent.Equal(decimal.RequireFromString("25")) || !values.Accounts[1].AllocationPercent.Equal(decimal.RequireFromString("75")) {
		t.Fatalf("allocations = %#v, want 25 then 75", values.Accounts)
	}
}

func TestCalculateAccountValuesCalculatesAllocationPercentAfterCurrencyConversion(t *testing.T) {
	firstAccountID := uuid.New()
	secondAccountID := uuid.New()
	values := calculateAccountValues(valuationData{
		BaseCurrency: "CAD",
		Accounts:     []valuationAccount{{ID: firstAccountID, Name: "First"}, {ID: secondAccountID, Name: "Second"}},
		Entries: []valuationEntry{
			cashEntryForAccount(firstAccountID, "First", "CAD Cash", "100"),
			cashEntryForAccountOnWithCurrency(secondAccountID, "Second", "USD Cash", "100", "USD", "2026-07-01"),
		},
		FXRates: []fxRate{fxRateOn("USD", "CAD", "2026-07-01", "1.50")},
	}, date("2026-07-07"))

	if !values.Accounts[0].AllocationPercent.Equal(decimal.RequireFromString("40")) || !values.Accounts[1].AllocationPercent.Equal(decimal.RequireFromString("60")) {
		t.Fatalf("allocations = %#v, want 40 then 60", values.Accounts)
	}
}

func TestGetValueHistoryRejectsInvalidRangeBeforeDatabaseAccess(t *testing.T) {
	_, err := (Service{}).GetValueHistory(context.Background(), uuid.New(), portfolio.Range("BAD"))
	if !errors.Is(err, portfolio.ErrInvalidRange) {
		t.Fatalf("GetValueHistory() error = %v, want %v", err, portfolio.ErrInvalidRange)
	}
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
	return cashEntryForAccountOnWithCurrency(accountID, accountName, assetName, amount, "CAD", tradeDate)
}

func cashEntryWithCurrency(accountID uuid.UUID, assetName string, amount string, currency string) valuationEntry {
	return cashEntryForAccountOnWithCurrency(accountID, "TFSA", assetName, amount, currency, "2026-07-01")
}

func cashEntryForAccountOnWithCurrency(accountID uuid.UUID, accountName string, assetName string, amount string, currency string, tradeDate string) valuationEntry {
	return valuationEntry{AccountID: accountID, AccountName: accountName, AssetID: uuid.New(), AssetName: assetName, AssetCurrency: currency, EntryType: "CASH", Amount: decimal.RequireFromString(amount), EntryCurrency: currency, TradeDate: date(tradeDate)}
}

func assetEntry(accountID uuid.UUID, assetID uuid.UUID, assetName string, quantity string) valuationEntry {
	return assetEntryWithCurrency(accountID, assetID, assetName, quantity, "CAD")
}

func assetEntryWithCurrency(accountID uuid.UUID, assetID uuid.UUID, assetName string, quantity string, currency string) valuationEntry {
	return valuationEntry{AccountID: accountID, AccountName: "TFSA", AssetID: assetID, AssetName: assetName, AssetCurrency: currency, EntryType: "ASSET_QUANTITY", Quantity: decimal.RequireFromString(quantity), EntryCurrency: currency, TradeDate: date("2026-07-01")}
}

func fxRateOn(fromCurrency string, toCurrency string, rateDate string, rate string) fxRate {
	return fxRate{FromCurrency: fromCurrency, ToCurrency: toCurrency, Date: date(rateDate), Rate: decimal.RequireFromString(rate), ProviderID: "demo", SourceQuality: "DEMO"}
}

func date(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}
