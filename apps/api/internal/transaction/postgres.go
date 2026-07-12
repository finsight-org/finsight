package transaction

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
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

func (r PostgresRepository) ListAccountTransactions(ctx context.Context, portfolioID uuid.UUID, accountID uuid.UUID) ([]AccountTransaction, error) {
	if r.db == nil {
		return nil, fmt.Errorf("postgres pool is required")
	}

	queries := db.New(r.db)
	if err := validateAccount(ctx, queries, portfolioID, accountID); err != nil {
		return nil, err
	}
	rows, err := queries.ListAccountLedgerEntries(ctx, db.ListAccountLedgerEntriesParams{
		PortfolioID: pgconv.UUID(portfolioID),
		AccountID:   pgconv.UUID(accountID),
	})
	if err != nil {
		return nil, fmt.Errorf("select account ledger entries: %w", err)
	}
	transactions, err := mapAccountTransactions(rows)
	if err != nil {
		return nil, fmt.Errorf("map account transactions: %w", err)
	}
	return transactions, nil
}

func (r PostgresRepository) ValidateAccount(ctx context.Context, portfolioID uuid.UUID, accountID uuid.UUID) error {
	if r.db == nil {
		return fmt.Errorf("postgres pool is required")
	}
	return validateAccount(ctx, db.New(r.db), portfolioID, accountID)
}

func (r PostgresRepository) ValidateAccountTransaction(ctx context.Context, portfolioID uuid.UUID, accountID uuid.UUID, transactionID uuid.UUID) error {
	if r.db == nil {
		return fmt.Errorf("postgres pool is required")
	}
	queries := db.New(r.db)
	if err := validateAccount(ctx, queries, portfolioID, accountID); err != nil {
		return err
	}
	if _, err := queries.GetAccountTransaction(ctx, db.GetAccountTransactionParams{
		PortfolioID: pgconv.UUID(portfolioID),
		AccountID:   pgconv.UUID(accountID),
		ID:          pgconv.UUID(transactionID),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("validate account transaction: %w", err)
	}
	return nil
}

func (r PostgresRepository) UpdateWithEntries(ctx context.Context, input updateRepositoryInput) (Transaction, error) {
	if r.db == nil {
		return Transaction{}, fmt.Errorf("postgres pool is required")
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Transaction{}, fmt.Errorf("begin transaction update: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	queries := db.New(tx)
	if err := validateAccount(ctx, queries, input.PortfolioID, input.AccountID); err != nil {
		return Transaction{}, err
	}
	if _, err := queries.GetAccountTransaction(ctx, db.GetAccountTransactionParams{
		PortfolioID: pgconv.UUID(input.PortfolioID),
		AccountID:   pgconv.UUID(input.AccountID),
		ID:          pgconv.UUID(input.TransactionID),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Transaction{}, ErrNotFound
		}
		return Transaction{}, fmt.Errorf("select transaction for update: %w", err)
	}
	if err := validateLedgerAssets(ctx, queries, input.WorkspaceID, input.LedgerEntries); err != nil {
		return Transaction{}, err
	}

	row, err := queries.UpdateAccountTransaction(ctx, db.UpdateAccountTransactionParams{
		PortfolioID:    pgconv.UUID(input.PortfolioID),
		AccountID:      pgconv.UUID(input.AccountID),
		ID:             pgconv.UUID(input.TransactionID),
		Type:           string(input.Type),
		TradeDate:      pgconv.Date(input.TradeDate),
		SettlementDate: pgconv.OptionalDate(input.SettlementDate),
		Description:    input.Description,
	})
	if err != nil {
		return Transaction{}, fmt.Errorf("update transaction: %w", err)
	}
	updated, err := mapTransaction(row)
	if err != nil {
		return Transaction{}, fmt.Errorf("map transaction: %w", err)
	}

	if err := queries.DeleteLedgerEntriesByTransaction(ctx, db.DeleteLedgerEntriesByTransactionParams{
		TransactionID: pgconv.UUID(input.TransactionID),
		AccountID:     pgconv.UUID(input.AccountID),
	}); err != nil {
		return Transaction{}, fmt.Errorf("delete old ledger entries: %w", err)
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
			return Transaction{}, fmt.Errorf("insert replacement ledger entry: %w", err)
		}
		mappedEntry, err := mapLedgerEntry(entryRow)
		if err != nil {
			return Transaction{}, fmt.Errorf("map replacement ledger entry: %w", err)
		}
		updated.LedgerEntries = append(updated.LedgerEntries, mappedEntry)
	}

	if err := tx.Commit(ctx); err != nil {
		return Transaction{}, fmt.Errorf("commit transaction update: %w", err)
	}
	return updated, nil
}

func (r PostgresRepository) Delete(ctx context.Context, portfolioID uuid.UUID, accountID uuid.UUID, transactionID uuid.UUID) error {
	if r.db == nil {
		return fmt.Errorf("postgres pool is required")
	}

	queries := db.New(r.db)
	if err := validateAccount(ctx, queries, portfolioID, accountID); err != nil {
		return err
	}
	rowsAffected, err := queries.DeleteAccountTransaction(ctx, db.DeleteAccountTransactionParams{
		PortfolioID: pgconv.UUID(portfolioID),
		AccountID:   pgconv.UUID(accountID),
		ID:          pgconv.UUID(transactionID),
	})
	if err != nil {
		return fmt.Errorf("delete transaction: %w", err)
	}
	if rowsAffected == 0 {
		return ErrNotFound
	}
	return nil
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

func mapAccountTransactions(rows []db.ListAccountLedgerEntriesRow) ([]AccountTransaction, error) {
	byID := map[uuid.UUID]*AccountTransaction{}
	order := []uuid.UUID{}
	for _, row := range rows {
		transactionID, err := pgconv.DomainUUID(row.TransactionID)
		if err != nil {
			return nil, fmt.Errorf("transaction id: %w", err)
		}
		transaction, ok := byID[transactionID]
		if !ok {
			mapped, err := mapAccountTransactionShell(row)
			if err != nil {
				return nil, err
			}
			byID[transactionID] = &mapped
			transaction = &mapped
			order = append(order, transactionID)
		}
		entry, err := mapAccountLedgerEntry(row)
		if err != nil {
			return nil, err
		}
		transaction.Entries = append(transaction.Entries, entry)
		transaction.LedgerEntries = append(transaction.LedgerEntries, entry.LedgerEntry)
	}

	transactions := make([]AccountTransaction, 0, len(order))
	for _, id := range order {
		transaction := *byID[id]
		summarizeAccountTransaction(&transaction)
		transactions = append(transactions, transaction)
	}
	return transactions, nil
}

func mapAccountTransactionShell(row db.ListAccountLedgerEntriesRow) (AccountTransaction, error) {
	id, err := pgconv.DomainUUID(row.TransactionID)
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("transaction id: %w", err)
	}
	portfolioID, err := pgconv.DomainUUID(row.PortfolioID)
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("portfolio id: %w", err)
	}
	accountID, err := pgconv.DomainUUID(row.AccountID)
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("account id: %w", err)
	}
	tradeDate, err := pgconv.DomainDate(row.TradeDate)
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("trade date: %w", err)
	}
	createdAt, err := pgconv.Time(row.TransactionCreatedAt)
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("transaction created at: %w", err)
	}
	updatedAt, err := pgconv.Time(row.TransactionUpdatedAt)
	if err != nil {
		return AccountTransaction{}, fmt.Errorf("transaction updated at: %w", err)
	}
	return AccountTransaction{
		Transaction: Transaction{
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
		},
	}, nil
}

func mapAccountLedgerEntry(row db.ListAccountLedgerEntriesRow) (AccountLedgerEntry, error) {
	id, err := pgconv.DomainUUID(row.LedgerEntryID)
	if err != nil {
		return AccountLedgerEntry{}, fmt.Errorf("ledger entry id: %w", err)
	}
	transactionID, err := pgconv.DomainUUID(row.TransactionID)
	if err != nil {
		return AccountLedgerEntry{}, fmt.Errorf("transaction id: %w", err)
	}
	accountID, err := pgconv.DomainUUID(row.AccountID)
	if err != nil {
		return AccountLedgerEntry{}, fmt.Errorf("account id: %w", err)
	}
	assetValue, err := mapLedgerAsset(row)
	if err != nil {
		return AccountLedgerEntry{}, err
	}
	quantity, err := pgconv.DomainNumeric(row.Quantity)
	if err != nil {
		return AccountLedgerEntry{}, fmt.Errorf("quantity: %w", err)
	}
	amount, err := pgconv.DomainNumeric(row.Amount)
	if err != nil {
		return AccountLedgerEntry{}, fmt.Errorf("amount: %w", err)
	}
	createdAt, err := pgconv.Time(row.LedgerEntryCreatedAt)
	if err != nil {
		return AccountLedgerEntry{}, fmt.Errorf("ledger entry created at: %w", err)
	}
	return AccountLedgerEntry{
		LedgerEntry: LedgerEntry{
			ID:               id,
			TransactionID:    transactionID,
			AccountID:        accountID,
			AssetID:          assetValue.ID,
			EntryType:        EntryType(row.EntryType),
			Quantity:         quantity,
			Amount:           amount,
			Currency:         row.EntryCurrency,
			OriginalAmount:   pgconv.OptionalDomainNumeric(row.OriginalAmount),
			OriginalCurrency: pgconv.StringPointer(row.OriginalCurrency),
			ExchangeRate:     pgconv.OptionalDomainNumeric(row.ExchangeRate),
			Direction:        Direction(row.Direction),
			CreatedAt:        createdAt,
		},
		Asset: assetValue,
	}, nil
}

func mapLedgerAsset(row db.ListAccountLedgerEntriesRow) (asset.Asset, error) {
	id, err := pgconv.DomainUUID(row.AssetID)
	if err != nil {
		return asset.Asset{}, fmt.Errorf("asset id: %w", err)
	}
	createdAt, err := pgconv.Time(row.AssetCreatedAt)
	if err != nil {
		return asset.Asset{}, fmt.Errorf("asset created at: %w", err)
	}
	updatedAt, err := pgconv.Time(row.AssetUpdatedAt)
	if err != nil {
		return asset.Asset{}, fmt.Errorf("asset updated at: %w", err)
	}
	return asset.Asset{
		ID:             id,
		Name:           row.AssetName,
		Type:           asset.Type(row.AssetType),
		Currency:       row.AssetCurrency,
		Symbol:         row.Symbol,
		ProviderID:     row.ProviderID,
		ProviderSymbol: row.ProviderSymbol,
		Exchange:       pgconv.StringPointer(row.Exchange),
		ISIN:           pgconv.StringPointer(row.Isin),
		Country:        pgconv.StringPointer(row.Country),
		Sector:         pgconv.StringPointer(row.Sector),
		IsActive:       row.IsActive,
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
	}, nil
}

func summarizeAccountTransaction(transaction *AccountTransaction) {
	fees := decimal.Zero
	cashImpact := decimal.Zero
	for _, entry := range transaction.Entries {
		switch entry.EntryType {
		case EntryTypeAssetQuantity:
			assetValue := entry.Asset
			transaction.Asset = &assetValue
			quantity := entry.Quantity.Abs()
			transaction.Quantity = &quantity
		case EntryTypeIncome:
			if entry.Asset.Type != asset.TypeCash {
				assetValue := entry.Asset
				transaction.Asset = &assetValue
			}
		case EntryTypeFee:
			fees = fees.Add(entry.Amount.Abs())
		case EntryTypeCash:
			cashImpact = cashImpact.Add(entry.Amount)
			transaction.Currency = entry.Currency
		}
	}
	if transaction.Currency == "" && len(transaction.Entries) > 0 {
		transaction.Currency = transaction.Entries[0].Currency
	}
	if !fees.IsZero() {
		transaction.Fees = &fees
	}
	if !cashImpact.IsZero() {
		transaction.CashImpact = &cashImpact
	}
	if transaction.Quantity != nil && transaction.CashImpact != nil {
		price := decimal.Zero
		switch transaction.Type {
		case TypeBuy:
			price = transaction.CashImpact.Abs().Sub(fees).Div(*transaction.Quantity)
		case TypeSell:
			price = transaction.CashImpact.Add(fees).Div(*transaction.Quantity)
		}
		if price.IsPositive() {
			transaction.Price = &price
		}
	}
}
