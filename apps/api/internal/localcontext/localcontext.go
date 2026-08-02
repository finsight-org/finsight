package localcontext

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type Repository interface {
	DefaultPortfolioID(context.Context) (uuid.UUID, error)
}

type Service struct {
	repository Repository
}

func NewService(repository Repository) Service {
	return Service{repository: repository}
}

func (s Service) DefaultPortfolioID(ctx context.Context) (uuid.UUID, error) {
	if s.repository == nil {
		return uuid.Nil, fmt.Errorf("local context repository is required")
	}

	portfolioID, err := s.repository.DefaultPortfolioID(ctx)
	if err != nil {
		return uuid.Nil, fmt.Errorf("get local default portfolio id: %w", err)
	}
	return portfolioID, nil
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
