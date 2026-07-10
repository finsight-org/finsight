package portfoliovalue

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
)

type PostgresRepository struct {
	db *pgxpool.Pool
}

func NewPostgresRepository(db *pgxpool.Pool) PostgresRepository {
	return PostgresRepository{db: db}
}

func (r PostgresRepository) LoadValuationData(ctx context.Context, portfolioID uuid.UUID, endDate time.Time) (valuationData, error) {
	if r.db == nil {
		return valuationData{}, fmt.Errorf("postgres pool is required")
	}

	queries := db.New(r.db)
	accountRows, err := queries.ListPortfolioAccountsForValuation(ctx, pgconv.UUID(portfolioID))
	if err != nil {
		return valuationData{}, fmt.Errorf("select portfolio accounts: %w", err)
	}

	entryRows, err := queries.ListPortfolioLedgerEntriesForValuation(ctx, db.ListPortfolioLedgerEntriesForValuationParams{
		PortfolioID: pgconv.UUID(portfolioID),
		EndDate:     pgconv.Date(endDate),
	})
	if err != nil {
		return valuationData{}, fmt.Errorf("select portfolio ledger entries: %w", err)
	}

	priceRows, err := queries.ListPortfolioMarketPricesForValuation(ctx, db.ListPortfolioMarketPricesForValuationParams{
		EndDate:     pgconv.Date(endDate),
		PortfolioID: pgconv.UUID(portfolioID),
	})
	if err != nil {
		return valuationData{}, fmt.Errorf("select portfolio market prices: %w", err)
	}

	data := valuationData{
		Accounts: make([]valuationAccount, 0, len(accountRows)),
		Entries:  make([]valuationEntry, 0, len(entryRows)),
		Prices:   make([]marketPrice, 0, len(priceRows)),
	}

	for _, row := range accountRows {
		id, err := pgconv.DomainUUID(row.ID)
		if err != nil {
			return valuationData{}, fmt.Errorf("map account id: %w", err)
		}
		data.Accounts = append(data.Accounts, valuationAccount{ID: id, Name: row.Name})
	}

	for _, row := range entryRows {
		entry, err := mapValuationEntry(row)
		if err != nil {
			return valuationData{}, fmt.Errorf("map ledger entry: %w", err)
		}
		data.Entries = append(data.Entries, entry)
	}

	for _, row := range priceRows {
		price, err := mapMarketPrice(row)
		if err != nil {
			return valuationData{}, fmt.Errorf("map market price: %w", err)
		}
		data.Prices = append(data.Prices, price)
	}

	return data, nil
}

func mapValuationEntry(row db.ListPortfolioLedgerEntriesForValuationRow) (valuationEntry, error) {
	accountID, err := pgconv.DomainUUID(row.AccountID)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("account id: %w", err)
	}
	assetID, err := pgconv.DomainUUID(row.AssetID)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("asset id: %w", err)
	}
	quantity, err := pgconv.DomainNumeric(row.Quantity)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("quantity: %w", err)
	}
	amount, err := pgconv.DomainNumeric(row.Amount)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("amount: %w", err)
	}
	tradeDate, err := pgconv.DomainDate(row.TradeDate)
	if err != nil {
		return valuationEntry{}, fmt.Errorf("trade date: %w", err)
	}
	return valuationEntry{
		AccountID:     accountID,
		AccountName:   row.AccountName,
		AssetID:       assetID,
		AssetName:     row.AssetName,
		AssetType:     row.AssetType,
		AssetCurrency: row.AssetCurrency,
		EntryType:     row.EntryType,
		Quantity:      quantity,
		Amount:        amount,
		EntryCurrency: row.EntryCurrency,
		TradeDate:     tradeDate,
	}, nil
}

func mapMarketPrice(row db.ListPortfolioMarketPricesForValuationRow) (marketPrice, error) {
	assetID, err := pgconv.DomainUUID(row.AssetID)
	if err != nil {
		return marketPrice{}, fmt.Errorf("asset id: %w", err)
	}
	date, err := pgconv.DomainDate(row.Date)
	if err != nil {
		return marketPrice{}, fmt.Errorf("date: %w", err)
	}
	price, err := pgconv.DomainNumeric(row.Price)
	if err != nil {
		return marketPrice{}, fmt.Errorf("price: %w", err)
	}
	return marketPrice{
		AssetID:       assetID,
		Date:          date,
		Price:         price,
		Currency:      row.Currency,
		ProviderID:    row.ProviderID,
		SourceQuality: row.SourceQuality,
	}, nil
}
