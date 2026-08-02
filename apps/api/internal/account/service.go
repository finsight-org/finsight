package account

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type Repository interface {
	Create(context.Context, createRepositoryInput) (Account, error)
	ListByPortfolio(context.Context, uuid.UUID) ([]Account, error)
	GetByPortfolioAndID(context.Context, uuid.UUID, uuid.UUID) (Account, error)
}

type Service struct {
	repository Repository
}

func NewService(repository Repository) Service {
	return Service{repository: repository}
}

func (s Service) CreateAccount(ctx context.Context, portfolioID uuid.UUID, input CreateInput) (Account, error) {
	if s.repository == nil {
		return Account{}, fmt.Errorf("account repository is required")
	}

	input = normalizeCreateInput(input)
	if input.Name == "" {
		return Account{}, ErrInvalidName
	}
	if !validType(input.Type) {
		return Account{}, ErrInvalidType
	}
	if !currencyPattern.MatchString(input.BaseCurrency) {
		return Account{}, ErrInvalidCurrency
	}

	account, err := s.repository.Create(ctx, createRepositoryInput{
		PortfolioID:       portfolioID,
		Name:              input.Name,
		InstitutionName:   input.InstitutionName,
		Type:              input.Type,
		BaseCurrency:      input.BaseCurrency,
		ExternalReference: input.ExternalReference,
	})
	if err != nil {
		return Account{}, fmt.Errorf("create account: %w", err)
	}

	return account, nil
}

func (s Service) ListAccounts(ctx context.Context, portfolioID uuid.UUID) ([]Account, error) {
	if s.repository == nil {
		return nil, fmt.Errorf("account repository is required")
	}

	accounts, err := s.repository.ListByPortfolio(ctx, portfolioID)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	return accounts, nil
}

func (s Service) GetAccount(ctx context.Context, portfolioID uuid.UUID, id uuid.UUID) (Account, error) {
	if s.repository == nil {
		return Account{}, fmt.Errorf("account repository is required")
	}

	account, err := s.repository.GetByPortfolioAndID(ctx, portfolioID, id)
	if err != nil {
		return Account{}, fmt.Errorf("get account: %w", err)
	}
	return account, nil
}
