package account

import (
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/textutil"
)

type Type string

const (
	TypeBrokerage      Type = "BROKERAGE"
	TypeBank           Type = "BANK"
	TypeCryptoExchange Type = "CRYPTO_EXCHANGE"
	TypeRetirement     Type = "RETIREMENT"
	TypeManual         Type = "MANUAL"
)

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

type Account struct {
	ID                uuid.UUID
	PortfolioID       uuid.UUID
	Name              string
	InstitutionName   *string
	Type              Type
	BaseCurrency      string
	ExternalReference *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type CreateInput struct {
	Name              string
	InstitutionName   *string
	Type              Type
	BaseCurrency      string
	ExternalReference *string
}

type createRepositoryInput struct {
	PortfolioID       uuid.UUID
	Name              string
	InstitutionName   *string
	Type              Type
	BaseCurrency      string
	ExternalReference *string
}

func normalizeCreateInput(input CreateInput) CreateInput {
	input.Name = strings.TrimSpace(input.Name)
	input.InstitutionName = textutil.TrimmedOptional(input.InstitutionName)
	input.ExternalReference = textutil.TrimmedOptional(input.ExternalReference)
	return input
}

func validType(value Type) bool {
	switch value {
	case TypeBrokerage, TypeBank, TypeCryptoExchange, TypeRetirement, TypeManual:
		return true
	default:
		return false
	}
}
