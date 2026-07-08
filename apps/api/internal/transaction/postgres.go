package transaction

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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

func (r PostgresRepository) CreateWithEntries(ctx context.Context, input createRepositoryInput) (Transaction, error) {
	if r.db == nil {
		return Transaction{}, fmt.Errorf("postgres pool is required")
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Transaction{}, fmt.Errorf("begin transaction insert: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	queries := db.New(tx)
	if err := validateAccount(ctx, queries, input.PortfolioID, input.AccountID); err != nil {
		return Transaction{}, err
	}
	if err := validateLedgerAssets(ctx, queries, input.WorkspaceID, input.LedgerEntries); err != nil {
		return Transaction{}, err
	}

	row, err := queries.CreateTransaction(ctx, db.CreateTransactionParams{
		PortfolioID:    pgconv.UUID(input.PortfolioID),
		AccountID:      pgconv.UUID(input.AccountID),
		ImportID:       pgconv.OptionalUUID(input.ImportID),
		Type:           string(input.Type),
		TradeDate:      pgconv.Date(input.TradeDate),
		SettlementDate: pgconv.OptionalDate(input.SettlementDate),
		Description:    input.Description,
		Source:         input.Source,
		ExternalID:     pgconv.Text(input.ExternalID),
		Status:         string(StatusConfirmed),
	})
	if err != nil {
		return Transaction{}, fmt.Errorf("insert transaction: %w", err)
	}

	created, err := mapTransaction(row)
	if err != nil {
		return Transaction{}, fmt.Errorf("map transaction: %w", err)
	}

	for _, entry := range input.LedgerEntries {
		entryRow, err := queries.CreateLedgerEntry(ctx, db.CreateLedgerEntryParams{
			TransactionID:    row.ID,
			AccountID:        pgconv.UUID(input.AccountID),
			AssetID:          pgconv.UUID(entry.AssetID),
			EntryType:        string(entry.EntryType),
			Quantity:         pgconv.Numeric(entry.Quantity),
			Amount:           pgconv.Numeric(entry.Amount),
			Currency:         entry.Currency,
			OriginalAmount:   pgconv.OptionalNumeric(entry.OriginalAmount),
			OriginalCurrency: pgconv.Text(entry.OriginalCurrency),
			ExchangeRate:     pgconv.OptionalNumeric(entry.ExchangeRate),
			Direction:        string(entry.Direction),
		})
		if err != nil {
			return Transaction{}, fmt.Errorf("insert ledger entry: %w", err)
		}
		mappedEntry, err := mapLedgerEntry(entryRow)
		if err != nil {
			return Transaction{}, fmt.Errorf("map ledger entry: %w", err)
		}
		created.LedgerEntries = append(created.LedgerEntries, mappedEntry)
	}

	if err := tx.Commit(ctx); err != nil {
		return Transaction{}, fmt.Errorf("commit transaction insert: %w", err)
	}
	return created, nil
}

func validateAccount(ctx context.Context, queries *db.Queries, portfolioID uuid.UUID, accountID uuid.UUID) error {
	_, err := queries.GetAccountByPortfolioAndID(ctx, db.GetAccountByPortfolioAndIDParams{
		PortfolioID: pgconv.UUID(portfolioID),
		ID:          pgconv.UUID(accountID),
	})
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("validate transaction account: %w", ErrInvalidAccount)
	}
	return fmt.Errorf("validate transaction account: %w", err)
}

func validateLedgerAssets(ctx context.Context, queries *db.Queries, workspaceID uuid.UUID, entries []CreateLedgerEntryInput) error {
	seen := map[uuid.UUID]struct{}{}
	for _, entry := range entries {
		if _, ok := seen[entry.AssetID]; ok {
			continue
		}
		seen[entry.AssetID] = struct{}{}

		_, err := queries.GetAssetByWorkspaceAndID(ctx, db.GetAssetByWorkspaceAndIDParams{
			WorkspaceID: pgconv.UUID(workspaceID),
			ID:          pgconv.UUID(entry.AssetID),
		})
		if err == nil {
			continue
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("validate ledger asset: %w", ErrInvalidEntryAsset)
		}
		return fmt.Errorf("validate ledger asset: %w", err)
	}
	return nil
}

func mapTransaction(row db.Transaction) (Transaction, error) {
	id, err := pgconv.DomainUUID(row.ID)
	if err != nil {
		return Transaction{}, fmt.Errorf("id: %w", err)
	}
	portfolioID, err := pgconv.DomainUUID(row.PortfolioID)
	if err != nil {
		return Transaction{}, fmt.Errorf("portfolio id: %w", err)
	}
	accountID, err := pgconv.DomainUUID(row.AccountID)
	if err != nil {
		return Transaction{}, fmt.Errorf("account id: %w", err)
	}
	tradeDate, err := pgconv.DomainDate(row.TradeDate)
	if err != nil {
		return Transaction{}, fmt.Errorf("trade date: %w", err)
	}
	createdAt, err := pgconv.Time(row.CreatedAt)
	if err != nil {
		return Transaction{}, fmt.Errorf("created at: %w", err)
	}
	updatedAt, err := pgconv.Time(row.UpdatedAt)
	if err != nil {
		return Transaction{}, fmt.Errorf("updated at: %w", err)
	}
	return Transaction{
		ID:             id,
		PortfolioID:    portfolioID,
		AccountID:      accountID,
		ImportID:       pgconv.OptionalDomainUUID(row.ImportID),
		Type:           Type(row.Type),
		TradeDate:      tradeDate,
		SettlementDate: pgconv.OptionalTime(row.SettlementDate),
		Description:    row.Description,
		Source:         row.Source,
		ExternalID:     pgconv.StringPointer(row.ExternalID),
		Status:         Status(row.Status),
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
	}, nil
}

func mapLedgerEntry(row db.LedgerEntry) (LedgerEntry, error) {
	id, err := pgconv.DomainUUID(row.ID)
	if err != nil {
		return LedgerEntry{}, fmt.Errorf("id: %w", err)
	}
	transactionID, err := pgconv.DomainUUID(row.TransactionID)
	if err != nil {
		return LedgerEntry{}, fmt.Errorf("transaction id: %w", err)
	}
	accountID, err := pgconv.DomainUUID(row.AccountID)
	if err != nil {
		return LedgerEntry{}, fmt.Errorf("account id: %w", err)
	}
	assetID, err := pgconv.DomainUUID(row.AssetID)
	if err != nil {
		return LedgerEntry{}, fmt.Errorf("asset id: %w", err)
	}
	quantity, err := pgconv.DomainNumeric(row.Quantity)
	if err != nil {
		return LedgerEntry{}, fmt.Errorf("quantity: %w", err)
	}
	amount, err := pgconv.DomainNumeric(row.Amount)
	if err != nil {
		return LedgerEntry{}, fmt.Errorf("amount: %w", err)
	}
	createdAt, err := pgconv.Time(row.CreatedAt)
	if err != nil {
		return LedgerEntry{}, fmt.Errorf("created at: %w", err)
	}
	return LedgerEntry{
		ID:               id,
		TransactionID:    transactionID,
		AccountID:        accountID,
		AssetID:          assetID,
		EntryType:        EntryType(row.EntryType),
		Quantity:         quantity,
		Amount:           amount,
		Currency:         row.Currency,
		OriginalAmount:   pgconv.OptionalDomainNumeric(row.OriginalAmount),
		OriginalCurrency: pgconv.StringPointer(row.OriginalCurrency),
		ExchangeRate:     pgconv.OptionalDomainNumeric(row.ExchangeRate),
		Direction:        Direction(row.Direction),
		CreatedAt:        createdAt,
	}, nil
}
