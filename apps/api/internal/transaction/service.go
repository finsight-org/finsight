package transaction

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/dateutil"
)

type Repository interface {
	CreateWithEntries(context.Context, createRepositoryInput) (Transaction, error)
}

type Service struct {
	repository Repository
}

func NewService(repository Repository) Service {
	return Service{repository: repository}
}

func (s Service) RecordTransaction(ctx context.Context, portfolioID uuid.UUID, input CreateInput) (Transaction, error) {
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

	recorded, err := s.repository.CreateWithEntries(ctx, createRepositoryInput{
		PortfolioID:    portfolioID,
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
