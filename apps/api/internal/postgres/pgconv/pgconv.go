package pgconv

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/shopspring/decimal"

	"github.com/finsight-org/finsight/apps/api/internal/dateutil"
)

func UUID(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: [16]byte(value), Valid: true}
}

func OptionalUUID(value *uuid.UUID) pgtype.UUID {
	if value == nil {
		return pgtype.UUID{}
	}
	return UUID(*value)
}

func DomainUUID(value pgtype.UUID) (uuid.UUID, error) {
	if !value.Valid {
		return uuid.Nil, fmt.Errorf("uuid is null")
	}
	return uuid.UUID(value.Bytes), nil
}

func OptionalDomainUUID(value pgtype.UUID) *uuid.UUID {
	if !value.Valid {
		return nil
	}
	id := uuid.UUID(value.Bytes)
	return &id
}

func Text(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

func StringPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func Date(value time.Time) pgtype.Date {
	return pgtype.Date{Time: dateutil.DateOnly(value), Valid: true}
}

func OptionalDate(value *time.Time) pgtype.Date {
	if value == nil {
		return pgtype.Date{}
	}
	return Date(*value)
}

func DomainDate(value pgtype.Date) (time.Time, error) {
	if !value.Valid {
		return time.Time{}, fmt.Errorf("date is null")
	}
	return dateutil.DateOnly(value.Time), nil
}

func OptionalTime(value pgtype.Date) *time.Time {
	if !value.Valid {
		return nil
	}
	date := dateutil.DateOnly(value.Time)
	return &date
}

func Time(value pgtype.Timestamptz) (time.Time, error) {
	if !value.Valid {
		return time.Time{}, fmt.Errorf("timestamp is null")
	}
	return value.Time, nil
}

func Numeric(value decimal.Decimal) pgtype.Numeric {
	return pgtype.Numeric{Int: value.Coefficient(), Exp: value.Exponent(), Valid: true}
}

func OptionalNumeric(value *decimal.Decimal) pgtype.Numeric {
	if value == nil {
		return pgtype.Numeric{}
	}
	return Numeric(*value)
}

func DomainNumeric(value pgtype.Numeric) (decimal.Decimal, error) {
	if !value.Valid {
		return decimal.Decimal{}, fmt.Errorf("numeric is null")
	}
	return decimal.NewFromBigInt(value.Int, value.Exp), nil
}

func OptionalDomainNumeric(value pgtype.Numeric) *decimal.Decimal {
	if !value.Valid {
		return nil
	}
	converted := decimal.NewFromBigInt(value.Int, value.Exp)
	return &converted
}
