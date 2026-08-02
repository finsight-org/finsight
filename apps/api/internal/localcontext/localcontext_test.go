package localcontext

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestDefaultPortfolioIDReturnsRepositoryValue(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := NewService(fakeRepository{portfolioID: portfolioID})

	found, err := service.DefaultPortfolioID(context.Background())
	if err != nil {
		t.Fatalf("DefaultPortfolioID() error = %v", err)
	}
	if found != portfolioID {
		t.Fatalf("DefaultPortfolioID() = %s, want %s", found, portfolioID)
	}
}

func TestDefaultPortfolioIDPreservesNotFound(t *testing.T) {
	service := NewService(fakeRepository{err: ErrNotFound})

	_, err := service.DefaultPortfolioID(context.Background())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("DefaultPortfolioID() error = %v, want ErrNotFound", err)
	}
}

func TestDefaultPortfolioIDWrapsRepositoryError(t *testing.T) {
	repositoryErr := errors.New("database unavailable")
	service := NewService(fakeRepository{err: repositoryErr})

	_, err := service.DefaultPortfolioID(context.Background())
	if !errors.Is(err, repositoryErr) {
		t.Fatalf("DefaultPortfolioID() error = %v, want wrapped repository error", err)
	}
}

type fakeRepository struct {
	portfolioID uuid.UUID
	err         error
}

func (r fakeRepository) DefaultPortfolioID(context.Context) (uuid.UUID, error) {
	return r.portfolioID, r.err
}
