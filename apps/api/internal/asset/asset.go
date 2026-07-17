package asset

import (
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/textutil"
)

type Type string

const (
	TypeEquity     Type = "EQUITY"
	TypeETF        Type = "ETF"
	TypeMutualFund Type = "MUTUAL_FUND"
	TypeCrypto     Type = "CRYPTO"
	TypeCash       Type = "CASH"
	TypeOther      Type = "OTHER"
)

const (
	DefaultSearchLimit = 10
	MaxSearchLimit     = 20
	MinSearchQueryLen  = 2
)

type SearchInput struct {
	Query string
	Limit *int
}

type AssetCandidate struct {
	Name           string
	Symbol         string
	Type           Type
	Currency       *string
	ProviderID     string
	ProviderSymbol string
	Exchange       *string
}

type Asset struct {
	ID             uuid.UUID
	WorkspaceID    uuid.UUID
	Name           string
	Type           Type
	Currency       string
	Symbol         string
	ProviderID     string
	ProviderSymbol string
	Exchange       *string
	ISIN           *string
	Country        *string
	Sector         *string
	IsActive       bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type UpsertInput struct {
	Name           string
	Type           Type
	Currency       string
	Symbol         string
	ProviderID     string
	ProviderSymbol string
	Exchange       *string
	ISIN           *string
	Country        *string
	Sector         *string
}

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

func normalizeSearchInput(input SearchInput) SearchInput {
	input.Query = strings.TrimSpace(input.Query)
	if input.Limit == nil {
		defaultLimit := DefaultSearchLimit
		input.Limit = &defaultLimit
	}
	return input
}

func normalizeUpsertInput(input UpsertInput) UpsertInput {
	input.Name = strings.TrimSpace(input.Name)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.Symbol = strings.TrimSpace(input.Symbol)
	input.ProviderID = strings.ToLower(strings.TrimSpace(input.ProviderID))
	input.ProviderSymbol = strings.ToLower(strings.TrimSpace(input.ProviderSymbol))
	input.Exchange = textutil.TrimmedOptional(input.Exchange)
	input.ISIN = textutil.TrimmedOptional(input.ISIN)
	input.Country = textutil.TrimmedOptional(input.Country)
	input.Sector = textutil.TrimmedOptional(input.Sector)
	return input
}

// PrepareUpsertInput normalizes and validates provider-backed asset data before
// it crosses a persistence boundary.
func PrepareUpsertInput(input UpsertInput) (UpsertInput, error) {
	input = normalizeUpsertInput(input)
	if input.Name == "" {
		return UpsertInput{}, ErrInvalidName
	}
	if !validType(input.Type) {
		return UpsertInput{}, ErrInvalidType
	}
	if !currencyPattern.MatchString(input.Currency) {
		return UpsertInput{}, ErrInvalidCurrency
	}
	if input.Symbol == "" {
		return UpsertInput{}, ErrInvalidSymbol
	}
	if input.ProviderID == "" || input.ProviderSymbol == "" {
		return UpsertInput{}, ErrInvalidProvider
	}
	return input, nil
}

func validType(value Type) bool {
	switch value {
	case TypeEquity, TypeETF, TypeMutualFund, TypeCrypto, TypeCash, TypeOther:
		return true
	default:
		return false
	}
}
