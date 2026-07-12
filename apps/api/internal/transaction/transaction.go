package transaction

import (
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/asset"
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

const SourceManual = "MANUAL"

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

type AccountTransaction struct {
	Transaction
	Asset      *asset.Asset
	Quantity   *decimal.Decimal
	Price      *decimal.Decimal
	Fees       *decimal.Decimal
	CashImpact *decimal.Decimal
	Currency   string
	Entries    []AccountLedgerEntry
}

type AccountLedgerEntry struct {
	LedgerEntry
	Asset asset.Asset
}

type Position struct {
	Asset    asset.Asset
	Quantity decimal.Decimal
	Currency string
}

type CashBalance struct {
	Currency string
	Balance  decimal.Decimal
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

type AssetInput struct {
	Name           string
	Type           asset.Type
	Currency       string
	Symbol         string
	ProviderID     string
	ProviderSymbol string
	Exchange       *string
}

type GuidedInput struct {
	AccountID      uuid.UUID
	Type           Type
	TradeDate      time.Time
	SettlementDate *time.Time
	Description    string
	Currency       string
	Asset          *AssetInput
	Quantity       *decimal.Decimal
	Price          *decimal.Decimal
	Amount         *decimal.Decimal
	Fees           *decimal.Decimal
}

type UpdateGuidedInput struct {
	TransactionID uuid.UUID
	GuidedInput
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

type createRepositoryInput struct {
	WorkspaceID    uuid.UUID
	PortfolioID    uuid.UUID
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

type updateRepositoryInput struct {
	PortfolioID    uuid.UUID
	AccountID      uuid.UUID
	TransactionID  uuid.UUID
	Type           Type
	TradeDate      time.Time
	SettlementDate *time.Time
	Description    string
	LedgerEntries  []CreateLedgerEntryInput
	WorkspaceID    uuid.UUID
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

func normalizeGuidedInput(input GuidedInput) GuidedInput {
	input.Description = strings.TrimSpace(input.Description)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	if input.Asset != nil {
		input.Asset.Name = strings.TrimSpace(input.Asset.Name)
		input.Asset.Symbol = strings.TrimSpace(input.Asset.Symbol)
		input.Asset.Currency = strings.ToUpper(strings.TrimSpace(input.Asset.Currency))
		input.Asset.ProviderID = strings.TrimSpace(input.Asset.ProviderID)
		input.Asset.ProviderSymbol = strings.TrimSpace(input.Asset.ProviderSymbol)
		input.Asset.Exchange = textutil.TrimmedOptional(input.Asset.Exchange)
	}
	return input
}

func validGuidedType(value Type) bool {
	switch value {
	case TypeBuy, TypeSell, TypeDividend, TypeDeposit, TypeWithdrawal, TypeFee, TypeInterest:
		return true
	default:
		return false
	}
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
