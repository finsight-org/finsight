package transaction

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/dateutil"
	"github.com/finsight-org/finsight/apps/api/internal/postgres"
	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
)

const (
	transactionTypeConstraint             = "transactions_type_check"
	transactionSourceConstraint           = "transactions_source_check"
	transactionAccountConstraint          = "transactions_account_portfolio_fk"
	ledgerEntryTypeConstraint             = "ledger_entries_entry_type_check"
	ledgerEntryCurrencyConstraint         = "ledger_entries_currency_check"
	ledgerEntryOriginalCurrencyConstraint = "ledger_entries_original_currency_check"
	ledgerEntryDirectionConstraint        = "ledger_entries_direction_check"
	ledgerEntryAssetConstraint            = "ledger_entries_asset_id_fkey"
	ledgerEntryAccountConstraint          = "ledger_entries_transaction_account_fk"
)

type Recorder struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Recorder {
	return &Recorder{pool: pool}
}

func (r *Recorder) Record(ctx context.Context, portfolioID uuid.UUID, input CreateInput) (Transaction, error) {
	input = normalizeCreateInput(input)
	if err := validateCreateInput(input); err != nil {
		return Transaction{}, err
	}
	input.TradeDate = dateutil.DateOnly(input.TradeDate)
	input.SettlementDate = optionalDate(input.SettlementDate)

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Transaction{}, fmt.Errorf("begin transaction insert: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	queries := database.New(tx)
	if err := validateAccount(ctx, queries, portfolioID, input.AccountID); err != nil {
		return Transaction{}, err
	}
	workspaceID, err := transactionWorkspaceID(ctx, queries, portfolioID)
	if err != nil {
		return Transaction{}, err
	}
	if err := validateLedgerAssets(ctx, queries, workspaceID, input.LedgerEntries); err != nil {
		return Transaction{}, err
	}

	row, err := queries.CreateTransaction(ctx, database.CreateTransactionParams{
		PortfolioID:    pgconv.UUID(portfolioID),
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
		return Transaction{}, translateTransactionError(err)
	}

	created, err := mapTransaction(row)
	if err != nil {
		return Transaction{}, fmt.Errorf("map transaction: %w", err)
	}

	for _, entry := range input.LedgerEntries {
		entryRow, err := queries.CreateLedgerEntry(ctx, database.CreateLedgerEntryParams{
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
			return Transaction{}, translateLedgerEntryError(err)
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

func translateTransactionError(err error) error {
	switch {
	case postgres.IsConstraintViolation(err, transactionTypeConstraint):
		return ErrInvalidType
	case postgres.IsConstraintViolation(err, transactionSourceConstraint):
		return ErrInvalidSource
	case postgres.IsConstraintViolation(err, transactionAccountConstraint):
		return ErrInvalidAccount
	default:
		return fmt.Errorf("insert transaction: %w", err)
	}
}

func translateLedgerEntryError(err error) error {
	switch {
	case postgres.IsConstraintViolation(err, ledgerEntryTypeConstraint):
		return ErrInvalidEntryType
	case postgres.IsConstraintViolation(err, ledgerEntryCurrencyConstraint, ledgerEntryOriginalCurrencyConstraint):
		return ErrInvalidEntryCurrency
	case postgres.IsConstraintViolation(err, ledgerEntryAssetConstraint):
		return ErrInvalidEntryAsset
	case postgres.IsConstraintViolation(err, ledgerEntryDirectionConstraint, ledgerEntryAccountConstraint):
		return ErrInvalidLedgerEntry
	default:
		return fmt.Errorf("insert ledger entry: %w", err)
	}
}

func transactionWorkspaceID(ctx context.Context, queries *database.Queries, portfolioID uuid.UUID) (uuid.UUID, error) {
	value, err := queries.GetTransactionWorkspaceID(ctx, pgconv.UUID(portfolioID))
	if err != nil {
		return uuid.Nil, fmt.Errorf("get transaction workspace: %w", err)
	}
	workspaceID, err := pgconv.DomainUUID(value)
	if err != nil {
		return uuid.Nil, fmt.Errorf("map transaction workspace id: %w", err)
	}
	return workspaceID, nil
}

func validateAccount(ctx context.Context, queries *database.Queries, portfolioID uuid.UUID, accountID uuid.UUID) error {
	_, err := queries.GetAccountByPortfolioAndID(ctx, database.GetAccountByPortfolioAndIDParams{
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

func validateLedgerAssets(ctx context.Context, queries *database.Queries, workspaceID uuid.UUID, entries []CreateLedgerEntryInput) error {
	seen := map[uuid.UUID]struct{}{}
	for _, entry := range entries {
		if _, ok := seen[entry.AssetID]; ok {
			continue
		}
		seen[entry.AssetID] = struct{}{}

		_, err := queries.GetAssetByWorkspaceAndID(ctx, database.GetAssetByWorkspaceAndIDParams{
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

func optionalDate(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	truncated := dateutil.DateOnly(*value)
	return &truncated
}

func mapTransaction(row database.Transaction) (Transaction, error) {
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

func mapLedgerEntry(row database.LedgerEntry) (LedgerEntry, error) {
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
