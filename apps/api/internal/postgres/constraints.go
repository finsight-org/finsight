package postgres

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

func IsConstraintViolation(err error, constraints ...string) bool {
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) {
		return false
	}
	for _, constraint := range constraints {
		if postgresError.ConstraintName == constraint {
			return true
		}
	}
	return false
}
