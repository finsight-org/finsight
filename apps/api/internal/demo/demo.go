package demo

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/account"
	"github.com/finsight-org/finsight/apps/api/internal/asset"
	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/transaction"
)

const (
	sourceDemo = "DEMO"
)

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

type AssetRegistry interface {
	UpsertAsset(context.Context, asset.UpsertInput) (asset.Asset, error)
}

type TransactionRecorder interface {
	RecordTransaction(context.Context, transaction.CreateInput) (transaction.Transaction, error)
}

type Repository interface {
	DeleteDemoData(context.Context, uuid.UUID, uuid.UUID) error
	UpsertDemoAccount(context.Context, upsertAccountInput) (account.Account, error)
	UpsertMarketPrice(context.Context, upsertMarketPriceInput) error
}

type Seeder struct {
	bootstrap    LocalBootstrapper
	assets       AssetRegistry
	transactions TransactionRecorder
	repository   Repository
}

type upsertAccountInput struct {
	PortfolioID       uuid.UUID
	Name              string
	InstitutionName   string
	Type              account.Type
	BaseCurrency      string
	ExternalReference string
}

type upsertMarketPriceInput struct {
	AssetID uuid.UUID
	Date    time.Time
	Price   decimal.Decimal
}

func NewSeeder(bootstrap LocalBootstrapper, assets AssetRegistry, transactions TransactionRecorder, repository Repository) Seeder {
	return Seeder{bootstrap: bootstrap, assets: assets, transactions: transactions, repository: repository}
}

func (s Seeder) Seed(ctx context.Context) error {
	if s.bootstrap == nil {
		return fmt.Errorf("demo bootstrapper is required")
	}
	if s.assets == nil {
		return fmt.Errorf("demo asset registry is required")
	}
	if s.transactions == nil {
		return fmt.Errorf("demo transaction recorder is required")
	}
	if s.repository == nil {
		return fmt.Errorf("demo repository is required")
	}

	localContext, err := s.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return fmt.Errorf("bootstrap local demo context: %w", err)
	}
	if err := s.repository.DeleteDemoData(ctx, localContext.Workspace.ID, localContext.Portfolio.ID); err != nil {
		return fmt.Errorf("delete existing demo data: %w", err)
	}

	tfsa, err := s.repository.UpsertDemoAccount(ctx, upsertAccountInput{
		PortfolioID:       localContext.Portfolio.ID,
		Name:              "Wealthsimple TFSA",
		InstitutionName:   "Wealthsimple",
		Type:              account.TypeRetirement,
		BaseCurrency:      "CAD",
		ExternalReference: "finsight-demo:wealthsimple-tfsa",
	})
	if err != nil {
		return fmt.Errorf("upsert demo TFSA account: %w", err)
	}
	margin, err := s.repository.UpsertDemoAccount(ctx, upsertAccountInput{
		PortfolioID:       localContext.Portfolio.ID,
		Name:              "Questrade Margin",
		InstitutionName:   "Questrade",
		Type:              account.TypeBrokerage,
		BaseCurrency:      "CAD",
		ExternalReference: "finsight-demo:questrade-margin",
	})
	if err != nil {
		return fmt.Errorf("upsert demo margin account: %w", err)
	}

	cash, err := s.assets.UpsertAsset(ctx, asset.UpsertInput{
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
	xeqt, err := s.assets.UpsertAsset(ctx, asset.UpsertInput{
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
	vfv, err := s.assets.UpsertAsset(ctx, asset.UpsertInput{
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

	if err := s.upsertPrices(ctx, xeqt.ID, []datedPrice{
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
	if err := s.upsertPrices(ctx, vfv.ID, []datedPrice{
		{date: "2026-02-01", price: "120"},
		{date: "2026-03-01", price: "125"},
		{date: "2026-04-01", price: "123"},
		{date: "2026-05-01", price: "130"},
		{date: "2026-06-01", price: "134"},
		{date: "2026-07-07", price: "136"},
	}); err != nil {
		return fmt.Errorf("upsert demo VFV prices: %w", err)
	}

	records := []transaction.CreateInput{
		deposit(tfsa.ID, cash.ID, "2026-01-02", "50000", "finsight-demo:tfsa-deposit-1"),
		buy(tfsa.ID, cash.ID, xeqt.ID, "2026-01-03", "100", "100", "finsight-demo:tfsa-buy-xeqt-1"),
		buy(tfsa.ID, cash.ID, vfv.ID, "2026-02-01", "100", "120", "finsight-demo:tfsa-buy-vfv-1"),
		deposit(margin.ID, cash.ID, "2026-03-15", "25000", "finsight-demo:margin-deposit-1"),
		buy(margin.ID, cash.ID, xeqt.ID, "2026-03-16", "150", "105", "finsight-demo:margin-buy-xeqt-1"),
		dividend(tfsa.ID, cash.ID, "2026-05-01", "120", "finsight-demo:tfsa-dividend-1"),
	}
	for _, record := range records {
		if _, err := s.transactions.RecordTransaction(ctx, record); err != nil {
			return fmt.Errorf("record demo transaction %s: %w", *record.ExternalID, err)
		}
	}

	return nil
}

type datedPrice struct {
	date  string
	price string
}

func (s Seeder) upsertPrices(ctx context.Context, assetID uuid.UUID, prices []datedPrice) error {
	for _, price := range prices {
		if err := s.repository.UpsertMarketPrice(ctx, upsertMarketPriceInput{
			AssetID: assetID,
			Date:    mustDate(price.date),
			Price:   decimal.RequireFromString(price.price),
		}); err != nil {
			return err
		}
	}
	return nil
}

func deposit(accountID uuid.UUID, cashAssetID uuid.UUID, date string, amount string, externalID string) transaction.CreateInput {
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
				Currency:  "CAD",
				Direction: transaction.DirectionIncrease,
			},
		},
	}
}

func buy(accountID uuid.UUID, cashAssetID uuid.UUID, assetID uuid.UUID, date string, quantity string, price string, externalID string) transaction.CreateInput {
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
				Currency:  "CAD",
				Direction: transaction.DirectionIncrease,
			},
			{
				AssetID:   cashAssetID,
				EntryType: transaction.EntryTypeCash,
				Amount:    cashAmount,
				Currency:  "CAD",
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
