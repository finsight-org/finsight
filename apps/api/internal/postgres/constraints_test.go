package postgres

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestIsConstraintViolation(t *testing.T) {
	databaseErr := fmt.Errorf("insert failed: %w", &pgconn.PgError{Code: "23514", ConstraintName: "assets_name_check"})
	if !IsConstraintViolation(databaseErr, "assets_symbol_check", "assets_name_check") {
		t.Fatal("IsConstraintViolation() = false, want true")
	}
	if IsConstraintViolation(databaseErr, "assets_symbol_check") {
		t.Fatal("IsConstraintViolation() = true for another constraint")
	}
	if IsConstraintViolation(errors.New("not PostgreSQL"), "assets_name_check") {
		t.Fatal("IsConstraintViolation() = true for non-PostgreSQL error")
	}
}
