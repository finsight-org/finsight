package transaction

import (
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/textutil"
)

type Type string

const (
	TypeDeposit        Type = "DEPOSIT"
	TypeWithdrawal     Type = "WITHDRAWAL"
	TypeBuy            Type = "BUY"
	TypeSell           Type = "SELL"
	TypeDividend       Type = "DIVIDEND"
	TypeInterest       Type = "INTEREST"
	TypeFee            Type = "FEE"
	TypeTax            Type = "TAX"
	TypeTransferIn     Type = "TRANSFER_IN"
	TypeTransferOut    Type = "TRANSFER_OUT"
	TypeFXConversion   Type = "FX_CONVERSION"
	TypeSplit          Type = "SPLIT"
	TypeOpeningBalance Type = "OPENING_BALANCE"
	TypeAdjustment     Type = "ADJUSTMENT"
)

type Status string

const StatusConfirmed Status = "CONFIRMED"

type EntryType string

const (
	EntryTypeAssetQuantity EntryType = "ASSET_QUANTITY"
	EntryTypeCash          EntryType = "CASH"
	EntryTypeFee           EntryType = "FEE"
	EntryTypeTax           EntryType = "TAX"
	EntryTypeIncome        EntryType = "INCOME"
	EntryTypeTransfer      EntryType = "TRANSFER"
	EntryTypeFX            EntryType = "FX"
)

type Direction string

const (
	DirectionIncrease Direction = "INCREASE"
	DirectionDecrease Direction = "DECREASE"
)

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

type Transaction struct {
	ID             uuid.UUID
	PortfolioID    uuid.UUID
	AccountID      uuid.UUID
	ImportID       *uuid.UUID
	Type           Type
	TradeDate      time.Time
	SettlementDate *time.Time
	Description    string
	Source         string
	ExternalID     *string
	Status         Status
	LedgerEntries  []LedgerEntry
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type LedgerEntry struct {
	ID               uuid.UUID
	TransactionID    uuid.UUID
	AccountID        uuid.UUID
	AssetID          uuid.UUID
	EntryType        EntryType
	Quantity         decimal.Decimal
	Amount           decimal.Decimal
	Currency         string
	OriginalAmount   *decimal.Decimal
	OriginalCurrency *string
	ExchangeRate     *decimal.Decimal
	Direction        Direction
	CreatedAt        time.Time
}

type CreateInput struct {
	AccountID      uuid.UUID
	ImportID       *uuid.UUID
	Type           Type
	TradeDate      time.Time
	SettlementDate *time.Time
	Description    string
	Source         string
	ExternalID     *string
	LedgerEntries  []CreateLedgerEntryInput
}

type CreateLedgerEntryInput struct {
	AssetID          uuid.UUID
	EntryType        EntryType
	Quantity         decimal.Decimal
	Amount           decimal.Decimal
	Currency         string
	OriginalAmount   *decimal.Decimal
	OriginalCurrency *string
	ExchangeRate     *decimal.Decimal
	Direction        Direction
}

func normalizeCreateInput(input CreateInput) CreateInput {
	input.Description = strings.TrimSpace(input.Description)
	input.Source = strings.ToUpper(strings.TrimSpace(input.Source))
	input.ExternalID = textutil.TrimmedOptional(input.ExternalID)
	for index := range input.LedgerEntries {
		input.LedgerEntries[index].Currency = strings.TrimSpace(input.LedgerEntries[index].Currency)
		input.LedgerEntries[index].OriginalCurrency = textutil.TrimmedOptional(input.LedgerEntries[index].OriginalCurrency)
	}
	return input
}

func validateCreateInput(input CreateInput) error {
	if input.AccountID == uuid.Nil {
		return ErrInvalidAccount
	}
	if !validType(input.Type) {
		return ErrInvalidType
	}
	if input.TradeDate.IsZero() {
		return ErrInvalidTradeDate
	}
	if input.Source == "" {
		return ErrInvalidSource
	}
	if len(input.LedgerEntries) == 0 {
		return ErrInvalidLedgerEntry
	}
	for _, entry := range input.LedgerEntries {
		if entry.AssetID == uuid.Nil {
			return ErrInvalidEntryAsset
		}
		if !validEntryType(entry.EntryType) {
			return ErrInvalidEntryType
		}
		if !currencyPattern.MatchString(entry.Currency) {
			return ErrInvalidEntryCurrency
		}
		if entry.OriginalCurrency != nil && !currencyPattern.MatchString(*entry.OriginalCurrency) {
			return ErrInvalidEntryCurrency
		}
		if !validDirection(entry.Direction) {
			return ErrInvalidLedgerEntry
		}
	}
	return nil
}

func validType(value Type) bool {
	switch value {
	case TypeDeposit, TypeWithdrawal, TypeBuy, TypeSell, TypeDividend, TypeInterest, TypeFee, TypeTax, TypeTransferIn, TypeTransferOut, TypeFXConversion, TypeSplit, TypeOpeningBalance, TypeAdjustment:
		return true
	default:
		return false
	}
}

func validEntryType(value EntryType) bool {
	switch value {
	case EntryTypeAssetQuantity, EntryTypeCash, EntryTypeFee, EntryTypeTax, EntryTypeIncome, EntryTypeTransfer, EntryTypeFX:
		return true
	default:
		return false
	}
}

func validDirection(value Direction) bool {
	switch value {
	case DirectionIncrease, DirectionDecrease:
		return true
	default:
		return false
	}
}
