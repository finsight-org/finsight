package httpapi

import (
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"github.com/shopspring/decimal"
)

func openapiUUID(value uuid.UUID) openapi_types.UUID {
	return openapi_types.UUID(value)
}

func openapiDate(value time.Time) openapi_types.Date {
	return openapi_types.Date{Time: value}
}

func decimalResponse(value decimal.Decimal) string {
	return value.Round(12).StringFixed(12)
}
