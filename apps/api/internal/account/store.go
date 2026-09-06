package account

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
	"github.com/finsight-org/finsight/apps/api/internal/postgres/pgconv"
)

const (
	accountNameConstraint              = "accounts_name_check"
	accountInstitutionNameConstraint   = "accounts_institution_name_check"
	accountExternalReferenceConstraint = "accounts_external_reference_check"
	accountTypeConstraint              = "accounts_type_check"
	accountCurrencyConstraint          = "accounts_base_currency_check"
	accountUniqueNameConstraint        = "accounts_portfolio_name_uidx"
)

type Store struct {
	queries *database.Queries
}

type CreateParams struct {
	PortfolioID       uuid.UUID
	Name              string
	InstitutionName   *string
	Type              string
	BaseCurrency      string
	ExternalReference *string
}

func New(queries *database.Queries) *Store {
	return &Store{queries: queries}
}

func (s *Store) Create(ctx context.Context, params CreateParams) (database.Account, error) {
	created, err := s.queries.CreateAccount(ctx, database.CreateAccountParams{
		PortfolioID:       pgconv.UUID(params.PortfolioID),
		Name:              params.Name,
		InstitutionName:   pgconv.Text(params.InstitutionName),
		Type:              params.Type,
		BaseCurrency:      params.BaseCurrency,
		ExternalReference: pgconv.Text(params.ExternalReference),
	})
	if err != nil {
		switch {
		case isConstraintViolation(err, accountUniqueNameConstraint):
			return database.Account{}, ErrDuplicateName
		case isConstraintViolation(err,
			accountNameConstraint,
			accountInstitutionNameConstraint,
			accountExternalReferenceConstraint,
			accountTypeConstraint,
			accountCurrencyConstraint,
		):
			return database.Account{}, ErrInvalidInput
		default:
			return database.Account{}, fmt.Errorf("create account: %w", err)
		}
	}
	return created, nil
}

func (s *Store) List(ctx context.Context, portfolioID uuid.UUID) ([]database.Account, error) {
	accounts, err := s.queries.ListAccountsByPortfolio(ctx, pgconv.UUID(portfolioID))
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	return accounts, nil
}

func (s *Store) Get(ctx context.Context, portfolioID uuid.UUID, id uuid.UUID) (database.Account, error) {
	found, err := s.queries.GetAccountByPortfolioAndID(ctx, database.GetAccountByPortfolioAndIDParams{
		PortfolioID: pgconv.UUID(portfolioID),
		ID:          pgconv.UUID(id),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return database.Account{}, ErrNotFound
		}
		return database.Account{}, fmt.Errorf("get account: %w", err)
	}
	return found, nil
}

func isConstraintViolation(err error, constraints ...string) bool {
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
