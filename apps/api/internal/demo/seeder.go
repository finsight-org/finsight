package demo

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
	"github.com/finsight-org/finsight/apps/api/internal/transaction"
)

const (
	sourceDemo = "DEMO"
)

type Seeder struct {
	assets       *asset.Store
	transactions *transaction.Recorder
	queries      *database.Queries
}

func NewSeeder(assets *asset.Store, transactions *transaction.Recorder, queries *database.Queries) *Seeder {
	return &Seeder{assets: assets, transactions: transactions, queries: queries}
}

func (s *Seeder) Seed(ctx context.Context, workspaceID uuid.UUID, portfolioID uuid.UUID) error {
	if err := s.deleteDemoData(ctx, workspaceID, portfolioID); err != nil {
		return fmt.Errorf("delete existing demo data: %w", err)
	}

	tfsaID, err := s.upsertDemoAccount(ctx, database.UpsertDemoAccountParams{
		PortfolioID:       pgconv.UUID(portfolioID),
		Name:              "Wealthsimple TFSA",
		InstitutionName:   pgconv.Text(strPtr("Wealthsimple")),
		Type:              "RETIREMENT",
		BaseCurrency:      "CAD",
		ExternalReference: pgconv.Text(strPtr("finsight-demo:wealthsimple-tfsa")),
	})
	if err != nil {
		return fmt.Errorf("upsert demo TFSA account: %w", err)
	}
	marginID, err := s.upsertDemoAccount(ctx, database.UpsertDemoAccountParams{
		PortfolioID:       pgconv.UUID(portfolioID),
		Name:              "Questrade Margin",
		InstitutionName:   pgconv.Text(strPtr("Questrade")),
		Type:              "BROKERAGE",
		BaseCurrency:      "CAD",
		ExternalReference: pgconv.Text(strPtr("finsight-demo:questrade-margin")),
	})
	if err != nil {
		return fmt.Errorf("upsert demo margin account: %w", err)
	}

	cashID, err := s.upsertAsset(ctx, workspaceID, asset.UpsertInput{
		Name:           "CAD Cash",
		Type:           asset.TypeCash,
		Currency:       "CAD",
		Symbol:         "CAD",
		ProviderID:     "demo",
		ProviderSymbol: "finsight-demo:cash-cad",
	})
	if err != nil {
		return fmt.Errorf("upsert demo cash asset: %w", err)
	}
	usdCashID, err := s.upsertAsset(ctx, workspaceID, asset.UpsertInput{
		Name:           "USD Cash",
		Type:           asset.TypeCash,
		Currency:       "USD",
		Symbol:         "USD",
		ProviderID:     "demo",
		ProviderSymbol: "finsight-demo:cash-usd",
	})
	if err != nil {
		return fmt.Errorf("upsert demo USD cash asset: %w", err)
	}
	xeqtID, err := s.upsertAsset(ctx, workspaceID, asset.UpsertInput{
		Name:           "iShares Core Equity ETF Portfolio",
		Type:           asset.TypeETF,
		Currency:       "CAD",
		Symbol:         "XEQT",
		ProviderID:     "demo",
		ProviderSymbol: "finsight-demo:xeqt",
		Exchange:       strPtr("TSX"),
	})
	if err != nil {
		return fmt.Errorf("upsert demo XEQT asset: %w", err)
	}
	vfvID, err := s.upsertAsset(ctx, workspaceID, asset.UpsertInput{
		Name:           "Vanguard S&P 500 Index ETF",
		Type:           asset.TypeETF,
		Currency:       "CAD",
		Symbol:         "VFV",
		ProviderID:     "demo",
		ProviderSymbol: "finsight-demo:vfv",
		Exchange:       strPtr("TSX"),
	})
	if err != nil {
		return fmt.Errorf("upsert demo VFV asset: %w", err)
	}
	vooID, err := s.upsertAsset(ctx, workspaceID, asset.UpsertInput{
		Name:           "Vanguard S&P 500 ETF",
		Type:           asset.TypeETF,
		Currency:       "USD",
		Symbol:         "VOO",
		ProviderID:     "demo",
		ProviderSymbol: "finsight-demo:voo",
		Exchange:       strPtr("NYSEARCA"),
	})
	if err != nil {
		return fmt.Errorf("upsert demo VOO asset: %w", err)
	}

	if err := s.upsertPrices(ctx, xeqtID, "CAD", []datedPrice{
		{date: "2026-01-01", price: "100"},
		{date: "2026-02-01", price: "102"},
		{date: "2026-03-01", price: "105"},
		{date: "2026-04-01", price: "108"},
		{date: "2026-05-01", price: "111"},
		{date: "2026-06-01", price: "113"},
		{date: "2026-07-07", price: "115"},
	}); err != nil {
		return fmt.Errorf("upsert demo XEQT prices: %w", err)
	}
	if err := s.upsertPrices(ctx, vfvID, "CAD", []datedPrice{
		{date: "2026-02-01", price: "120"},
		{date: "2026-03-01", price: "125"},
		{date: "2026-04-01", price: "123"},
		{date: "2026-05-01", price: "130"},
		{date: "2026-06-01", price: "134"},
		{date: "2026-07-07", price: "136"},
	}); err != nil {
		return fmt.Errorf("upsert demo VFV prices: %w", err)
	}
	if err := s.upsertPrices(ctx, vooID, "USD", []datedPrice{
		{date: "2026-03-01", price: "380"},
		{date: "2026-04-01", price: "392"},
		{date: "2026-05-01", price: "401"},
		{date: "2026-06-01", price: "415"},
		{date: "2026-07-07", price: "420"},
	}); err != nil {
		return fmt.Errorf("upsert demo VOO prices: %w", err)
	}
	if err := s.upsertFXRates(ctx, workspaceID, "USD", "CAD", []datedRate{
		{date: "2026-01-01", rate: "1.36"},
		{date: "2026-02-01", rate: "1.35"},
		{date: "2026-03-01", rate: "1.34"},
		{date: "2026-04-01", rate: "1.37"},
		{date: "2026-05-01", rate: "1.36"},
		{date: "2026-06-01", rate: "1.35"},
		{date: "2026-07-07", rate: "1.34"},
	}); err != nil {
		return fmt.Errorf("upsert demo USD/CAD FX rates: %w", err)
	}

	records := []transaction.CreateInput{
		deposit(tfsaID, cashID, "2026-01-02", "50000", "finsight-demo:tfsa-deposit-1"),
		buy(tfsaID, cashID, xeqtID, "2026-01-03", "100", "100", "finsight-demo:tfsa-buy-xeqt-1"),
		buy(tfsaID, cashID, vfvID, "2026-02-01", "100", "120", "finsight-demo:tfsa-buy-vfv-1"),
		deposit(marginID, cashID, "2026-03-15", "25000", "finsight-demo:margin-deposit-1"),
		buy(marginID, cashID, xeqtID, "2026-03-16", "150", "105", "finsight-demo:margin-buy-xeqt-1"),
		depositWithCurrency(marginID, usdCashID, "2026-04-01", "10000", "USD", "finsight-demo:margin-usd-deposit-1"),
		buyWithCurrency(marginID, usdCashID, vooID, "2026-04-02", "10", "392", "USD", "finsight-demo:margin-buy-voo-1"),
		dividend(tfsaID, cashID, "2026-05-01", "120", "finsight-demo:tfsa-dividend-1"),
	}
	for _, record := range records {
		if _, err := s.transactions.Record(ctx, portfolioID, record); err != nil {
			return fmt.Errorf("record demo transaction %s: %w", *record.ExternalID, err)
		}
	}

	return nil
}

func (s *Seeder) deleteDemoData(ctx context.Context, workspaceID uuid.UUID, portfolioID uuid.UUID) error {
	if err := s.queries.DeleteDemoTransactions(ctx, pgconv.UUID(portfolioID)); err != nil {
		return fmt.Errorf("delete demo transactions: %w", err)
	}
	if err := s.queries.DeleteDemoMarketPrices(ctx, pgconv.UUID(workspaceID)); err != nil {
		return fmt.Errorf("delete demo market prices: %w", err)
	}
	if err := s.queries.DeleteDemoFxRates(ctx, pgconv.UUID(workspaceID)); err != nil {
		return fmt.Errorf("delete demo fx rates: %w", err)
	}
	return nil
}

func (s *Seeder) upsertDemoAccount(ctx context.Context, params database.UpsertDemoAccountParams) (uuid.UUID, error) {
	row, err := s.queries.UpsertDemoAccount(ctx, params)
	if err != nil {
		return uuid.Nil, fmt.Errorf("upsert demo account: %w", err)
	}
	id, err := pgconv.DomainUUID(row.ID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("map demo account id: %w", err)
	}
	return id, nil
}

func (s *Seeder) upsertAsset(ctx context.Context, workspaceID uuid.UUID, input asset.UpsertInput) (uuid.UUID, error) {
	row, err := s.assets.Upsert(ctx, workspaceID, input)
	if err != nil {
		return uuid.Nil, err
	}
	id, err := pgconv.DomainUUID(row.ID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("map demo asset id: %w", err)
	}
	return id, nil
}

type datedPrice struct {
	date  string
	price string
}

type datedRate struct {
	date string
	rate string
}

func (s *Seeder) upsertPrices(ctx context.Context, assetID uuid.UUID, currency string, prices []datedPrice) error {
	for _, price := range prices {
		if _, err := s.queries.UpsertMarketPrice(ctx, database.UpsertMarketPriceParams{
			AssetID:       pgconv.UUID(assetID),
			Date:          pgconv.Date(mustDate(price.date)),
			Price:         pgconv.Numeric(decimal.RequireFromString(price.price)),
			Currency:      currency,
			ProviderID:    "demo",
			SourceQuality: "DEMO",
		}); err != nil {
			return fmt.Errorf("upsert market price: %w", err)
		}
	}
	return nil
}

func (s *Seeder) upsertFXRates(ctx context.Context, workspaceID uuid.UUID, fromCurrency string, toCurrency string, rates []datedRate) error {
	for _, rate := range rates {
		if _, err := s.queries.UpsertDemoFxRate(ctx, database.UpsertDemoFxRateParams{
			WorkspaceID:   pgconv.UUID(workspaceID),
			FromCurrency:  fromCurrency,
			ToCurrency:    toCurrency,
			Date:          pgconv.Date(mustDate(rate.date)),
			Rate:          pgconv.Numeric(decimal.RequireFromString(rate.rate)),
			ProviderID:    "demo",
			SourceQuality: "DEMO",
		}); err != nil {
			return fmt.Errorf("upsert fx rate: %w", err)
		}
	}
	return nil
}

func deposit(accountID uuid.UUID, cashAssetID uuid.UUID, date string, amount string, externalID string) transaction.CreateInput {
	return depositWithCurrency(accountID, cashAssetID, date, amount, "CAD", externalID)
}

func depositWithCurrency(accountID uuid.UUID, cashAssetID uuid.UUID, date string, amount string, currency string, externalID string) transaction.CreateInput {
	value := decimal.RequireFromString(amount)
	return transaction.CreateInput{
		AccountID:   accountID,
		Type:        transaction.TypeDeposit,
		TradeDate:   mustDate(date),
		Description: "Demo deposit",
		Source:      sourceDemo,
		ExternalID:  strPtr(externalID),
		LedgerEntries: []transaction.CreateLedgerEntryInput{
			{
				AssetID:   cashAssetID,
				EntryType: transaction.EntryTypeCash,
				Amount:    value,
				Currency:  currency,
				Direction: transaction.DirectionIncrease,
			},
		},
	}
}

func buy(accountID uuid.UUID, cashAssetID uuid.UUID, assetID uuid.UUID, date string, quantity string, price string, externalID string) transaction.CreateInput {
	return buyWithCurrency(accountID, cashAssetID, assetID, date, quantity, price, "CAD", externalID)
}

func buyWithCurrency(accountID uuid.UUID, cashAssetID uuid.UUID, assetID uuid.UUID, date string, quantity string, price string, currency string, externalID string) transaction.CreateInput {
	qty := decimal.RequireFromString(quantity)
	cashAmount := qty.Mul(decimal.RequireFromString(price)).Neg()
	return transaction.CreateInput{
		AccountID:   accountID,
		Type:        transaction.TypeBuy,
		TradeDate:   mustDate(date),
		Description: "Demo buy",
		Source:      sourceDemo,
		ExternalID:  strPtr(externalID),
		LedgerEntries: []transaction.CreateLedgerEntryInput{
			{
				AssetID:   assetID,
				EntryType: transaction.EntryTypeAssetQuantity,
				Quantity:  qty,
				Currency:  currency,
				Direction: transaction.DirectionIncrease,
			},
			{
				AssetID:   cashAssetID,
				EntryType: transaction.EntryTypeCash,
				Amount:    cashAmount,
				Currency:  currency,
				Direction: transaction.DirectionDecrease,
			},
		},
	}
}

func dividend(accountID uuid.UUID, cashAssetID uuid.UUID, date string, amount string, externalID string) transaction.CreateInput {
	value := decimal.RequireFromString(amount)
	return transaction.CreateInput{
		AccountID:   accountID,
		Type:        transaction.TypeDividend,
		TradeDate:   mustDate(date),
		Description: "Demo dividend",
		Source:      sourceDemo,
		ExternalID:  strPtr(externalID),
		LedgerEntries: []transaction.CreateLedgerEntryInput{
			{
				AssetID:   cashAssetID,
				EntryType: transaction.EntryTypeIncome,
				Amount:    value,
				Currency:  "CAD",
				Direction: transaction.DirectionIncrease,
			},
			{
				AssetID:   cashAssetID,
				EntryType: transaction.EntryTypeCash,
				Amount:    value,
				Currency:  "CAD",
				Direction: transaction.DirectionIncrease,
			},
		},
	}
}

func mustDate(value string) time.Time {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return parsed
}

func strPtr(value string) *string {
	return &value
}
