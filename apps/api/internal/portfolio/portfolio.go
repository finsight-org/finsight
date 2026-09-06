package portfolio

import (
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

type Range string

const (
	RangeOneDay      Range = "1D"
	RangeOneWeek     Range = "1W"
	RangeOneMonth    Range = "1M"
	RangeThreeMonths Range = "3M"
	RangeYearToDate  Range = "YTD"
	RangeOneYear     Range = "1Y"
	RangeAll         Range = "ALL"
)

const BaseCurrencyCAD = "CAD"

type Warning struct {
	Code    string
	Message string
}

type Overview struct {
	BaseCurrency  string
	TotalValue    decimal.Decimal
	ValuationDate time.Time
	Warnings      []Warning
}

type ValuePoint struct {
	Date  time.Time
	Value decimal.Decimal
}

type ValueHistory struct {
	BaseCurrency string
	Range        Range
	Points       []ValuePoint
	Warnings     []Warning
}

type AccountValue struct {
	AccountID         uuid.UUID
	AccountName       string
	Value             decimal.Decimal
	AllocationPercent decimal.Decimal
}

type AccountValues struct {
	BaseCurrency  string
	ValuationDate time.Time
	Accounts      []AccountValue
	Warnings      []Warning
}

func ValidRange(value Range) bool {
	switch value {
	case RangeOneDay, RangeOneWeek, RangeOneMonth, RangeThreeMonths, RangeYearToDate, RangeOneYear, RangeAll:
		return true
	default:
		return false
	}
}
