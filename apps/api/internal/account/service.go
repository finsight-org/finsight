package account

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
)

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

type Repository interface {
	Create(context.Context, createRepositoryInput) (Account, error)
	ListByPortfolio(context.Context, uuid.UUID) ([]Account, error)
	GetByPortfolioAndID(context.Context, uuid.UUID, uuid.UUID) (Account, error)
}

type Service struct {
	bootstrap  LocalBootstrapper
	repository Repository
}

func NewService(bootstrap LocalBootstrapper, repository Repository) Service {
	return Service{bootstrap: bootstrap, repository: repository}
}

func (s Service) CreateAccount(ctx context.Context, input CreateInput) (Account, error) {
	if s.bootstrap == nil {
		return Account{}, fmt.Errorf("account bootstrapper is required")
	}
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

	localContext, err := s.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return Account{}, fmt.Errorf("resolve local account context: %w", err)
	}

	account, err := s.repository.Create(ctx, createRepositoryInput{
		PortfolioID:       localContext.Portfolio.ID,
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

func (s Service) ListAccounts(ctx context.Context) ([]Account, error) {
	if s.bootstrap == nil {
		return nil, fmt.Errorf("account bootstrapper is required")
	}
	if s.repository == nil {
		return nil, fmt.Errorf("account repository is required")
	}

	localContext, err := s.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return nil, fmt.Errorf("resolve local account context: %w", err)
	}

	accounts, err := s.repository.ListByPortfolio(ctx, localContext.Portfolio.ID)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	return accounts, nil
}

func (s Service) GetAccount(ctx context.Context, id uuid.UUID) (Account, error) {
	if s.bootstrap == nil {
		return Account{}, fmt.Errorf("account bootstrapper is required")
	}
	if s.repository == nil {
		return Account{}, fmt.Errorf("account repository is required")
	}

	localContext, err := s.bootstrap.BootstrapLocal(ctx)
	if err != nil {
		return Account{}, fmt.Errorf("resolve local account context: %w", err)
	}

	account, err := s.repository.GetByPortfolioAndID(ctx, localContext.Portfolio.ID, id)
	if err != nil {
		return Account{}, fmt.Errorf("get account: %w", err)
	}
	return account, nil
}
