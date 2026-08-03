package localcontext

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type Repository interface {
	DefaultScope(context.Context) (Scope, error)
}

type Scope struct {
	WorkspaceID uuid.UUID
	PortfolioID uuid.UUID
}

type Service struct {
	repository Repository
}

func NewService(repository Repository) Service {
	return Service{repository: repository}
}

func (s Service) DefaultScope(ctx context.Context) (Scope, error) {
	if s.repository == nil {
		return Scope{}, fmt.Errorf("local context repository is required")
	}

	scope, err := s.repository.DefaultScope(ctx)
	if err != nil {
		return Scope{}, fmt.Errorf("get local default scope: %w", err)
	}
	return scope, nil
}

func (s Service) DefaultPortfolioID(ctx context.Context) (uuid.UUID, error) {
	scope, err := s.DefaultScope(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	return scope.PortfolioID, nil
}

func (s Service) EnsurePortfolio(ctx context.Context, portfolioID uuid.UUID) error {
	defaultPortfolioID, err := s.DefaultPortfolioID(ctx)
	if err != nil {
		return err
	}
	if portfolioID != defaultPortfolioID {
		return ErrPortfolioNotAllowed
	}
	return nil
}
