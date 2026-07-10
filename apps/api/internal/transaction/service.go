package transaction

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/dateutil"
)

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

type Repository interface {
	CreateWithEntries(context.Context, createRepositoryInput) (Transaction, error)
}

type Service struct {
	bootstrap  LocalBootstrapper
	repository Repository
}

func NewService(bootstrap LocalBootstrapper, repository Repository) Service {
	return Service{bootstrap: bootstrap, repository: repository}
}

func (s Service) RecordTransaction(ctx context.Context, input CreateInput) (Transaction, error) {
	if s.bootstrap == nil {
		return Transaction{}, fmt.Errorf("transaction bootstrapper is required")
	}
	if s.repository == nil {
		return Transaction{}, fmt.Errorf("transaction repository is required")
	}

	input = normalizeCreateInput(input)
	if input.AccountID == uuid.Nil {
		return Transaction{}, ErrInvalidAccount
	}
	if !validType(input.Type) {
		return Transaction{}, ErrInvalidType
	}
	if input.TradeDate.IsZero() {
		return Transaction{}, ErrInvalidTradeDate
	}
	if input.Source == "" {
		return Transaction{}, ErrInvalidSource
	}
	if len(input.LedgerEntries) == 0 {
		return Transaction{}, ErrInvalidLedgerEntry
	}
	for _, entry := range input.LedgerEntries {
		if entry.AssetID == uuid.Nil {
			return Transaction{}, ErrInvalidEntryAsset
		}
		if !validEntryType(entry.EntryType) {
			return Transaction{}, ErrInvalidEntryType
		}
		if !currencyPattern.MatchString(entry.Currency) {
			return Transaction{}, ErrInvalidEntryCurrency
		}
		if entry.OriginalCurrency != nil && !currencyPattern.MatchString(*entry.OriginalCurrency) {
			return Transaction{}, ErrInvalidEntryCurrency
		}
		if !validDirection(entry.Direction) {
			return Transaction{}, ErrInvalidLedgerEntry
		}
	}

	localContext, err := s.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return Transaction{}, fmt.Errorf("resolve local transaction context: %w", err)
	}

	recorded, err := s.repository.CreateWithEntries(ctx, createRepositoryInput{
		WorkspaceID:    localContext.Workspace.ID,
		PortfolioID:    localContext.Portfolio.ID,
		AccountID:      input.AccountID,
		ImportID:       input.ImportID,
		Type:           input.Type,
		TradeDate:      dateutil.DateOnly(input.TradeDate),
		SettlementDate: optionalDate(input.SettlementDate),
		Description:    input.Description,
		Source:         input.Source,
		ExternalID:     input.ExternalID,
		LedgerEntries:  input.LedgerEntries,
	})
	if err != nil {
		return Transaction{}, fmt.Errorf("record transaction: %w", err)
	}
	return recorded, nil
}

func optionalDate(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	truncated := dateutil.DateOnly(*value)
	return &truncated
}
