package account

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
)

const accountsPortfolioNameConstraint = "accounts_portfolio_name_uidx"

type PostgresRepository struct {
	db *pgxpool.Pool
}

func NewPostgresRepository(db *pgxpool.Pool) PostgresRepository {
	return PostgresRepository{db: db}
}

func (r PostgresRepository) Create(ctx context.Context, input createRepositoryInput) (Account, error) {
	if r.db == nil {
		return Account{}, fmt.Errorf("postgres pool is required")
	}

	row, err := db.New(r.db).CreateAccount(ctx, db.CreateAccountParams{
		PortfolioID:       pgUUID(input.PortfolioID),
		Name:              input.Name,
		InstitutionName:   pgText(input.InstitutionName),
		Type:              string(input.Type),
		BaseCurrency:      input.BaseCurrency,
		ExternalReference: pgText(input.ExternalReference),
	})
	if err != nil {
		if isUniqueViolation(err, accountsPortfolioNameConstraint) {
			return Account{}, ErrDuplicateName
		}
		return Account{}, fmt.Errorf("insert account: %w", err)
	}

	account, err := mapAccount(row)
	if err != nil {
		return Account{}, fmt.Errorf("map account: %w", err)
	}
	return account, nil
}

func (r PostgresRepository) ListByPortfolio(ctx context.Context, portfolioID uuid.UUID) ([]Account, error) {
	if r.db == nil {
		return nil, fmt.Errorf("postgres pool is required")
	}

	rows, err := db.New(r.db).ListAccountsByPortfolio(ctx, pgUUID(portfolioID))
	if err != nil {
		return nil, fmt.Errorf("select accounts: %w", err)
	}
	accounts := make([]Account, 0, len(rows))
	for _, row := range rows {
		account, err := mapAccount(row)
		if err != nil {
			return nil, fmt.Errorf("map account: %w", err)
		}
		accounts = append(accounts, account)
	}
	return accounts, nil
}

func (r PostgresRepository) GetByPortfolioAndID(ctx context.Context, portfolioID uuid.UUID, id uuid.UUID) (Account, error) {
	if r.db == nil {
		return Account{}, fmt.Errorf("postgres pool is required")
	}

	row, err := db.New(r.db).GetAccountByPortfolioAndID(ctx, db.GetAccountByPortfolioAndIDParams{
		PortfolioID: pgUUID(portfolioID),
		ID:          pgUUID(id),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Account{}, ErrNotFound
		}
		return Account{}, fmt.Errorf("select account: %w", err)
	}

	account, err := mapAccount(row)
	if err != nil {
		return Account{}, fmt.Errorf("map account: %w", err)
	}
	return account, nil
}

func mapAccount(row db.Account) (Account, error) {
	id, err := domainUUID(row.ID)
	if err != nil {
		return Account{}, fmt.Errorf("id: %w", err)
	}
	portfolioID, err := domainUUID(row.PortfolioID)
	if err != nil {
		return Account{}, fmt.Errorf("portfolio id: %w", err)
	}
	createdAt, err := domainTime(row.CreatedAt)
	if err != nil {
		return Account{}, fmt.Errorf("created at: %w", err)
	}
	updatedAt, err := domainTime(row.UpdatedAt)
	if err != nil {
		return Account{}, fmt.Errorf("updated at: %w", err)
	}
	return Account{
		ID:                id,
		PortfolioID:       portfolioID,
		Name:              row.Name,
		InstitutionName:   stringPointer(row.InstitutionName),
		Type:              Type(row.Type),
		BaseCurrency:      row.BaseCurrency,
		ExternalReference: stringPointer(row.ExternalReference),
		CreatedAt:         createdAt,
		UpdatedAt:         updatedAt,
	}, nil
}

func pgUUID(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: [16]byte(value), Valid: true}
}

func domainUUID(value pgtype.UUID) (uuid.UUID, error) {
	if !value.Valid {
		return uuid.Nil, fmt.Errorf("uuid is null")
	}
	return uuid.UUID(value.Bytes), nil
}

func pgText(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

func stringPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func domainTime(value pgtype.Timestamptz) (time.Time, error) {
	if !value.Valid {
		return time.Time{}, fmt.Errorf("timestamp is null")
	}
	return value.Time, nil
}

func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}
