package asset

import "strings"

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

func normalizeSearchInput(input SearchInput) SearchInput {
	input.Query = strings.TrimSpace(input.Query)
	if input.Limit == nil {
		defaultLimit := DefaultSearchLimit
		input.Limit = &defaultLimit
	}
	return input
}

func normalizedOptional(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
