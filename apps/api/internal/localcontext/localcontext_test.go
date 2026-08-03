package localcontext

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestDefaultScopeReturnsRepositoryValue(t *testing.T) {
	workspaceID := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := NewService(fakeRepository{scope: Scope{WorkspaceID: workspaceID, PortfolioID: portfolioID}})

	found, err := service.DefaultScope(context.Background())
	if err != nil {
		t.Fatalf("DefaultScope() error = %v", err)
	}
	if found != (Scope{WorkspaceID: workspaceID, PortfolioID: portfolioID}) {
		t.Fatalf("DefaultScope() = %+v, want workspace %s and portfolio %s", found, workspaceID, portfolioID)
	}
}

func TestDefaultScopePreservesNotFound(t *testing.T) {
	service := NewService(fakeRepository{err: ErrNotFound})

	_, err := service.DefaultScope(context.Background())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("DefaultScope() error = %v, want ErrNotFound", err)
	}
}

func TestDefaultScopeWrapsRepositoryError(t *testing.T) {
	repositoryErr := errors.New("database unavailable")
	service := NewService(fakeRepository{err: repositoryErr})

	_, err := service.DefaultScope(context.Background())
	if !errors.Is(err, repositoryErr) {
		t.Fatalf("DefaultScope() error = %v, want wrapped repository error", err)
	}
}

func TestDefaultPortfolioIDUsesDefaultScope(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := NewService(fakeRepository{scope: Scope{WorkspaceID: uuid.New(), PortfolioID: portfolioID}})

	found, err := service.DefaultPortfolioID(context.Background())
	if err != nil {
		t.Fatalf("DefaultPortfolioID() error = %v", err)
	}
	if found != portfolioID {
		t.Fatalf("DefaultPortfolioID() = %s, want %s", found, portfolioID)
	}
}

func TestEnsurePortfolioAllowsDefaultPortfolio(t *testing.T) {
	portfolioID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	service := NewService(fakeRepository{scope: Scope{WorkspaceID: uuid.New(), PortfolioID: portfolioID}})

	if err := service.EnsurePortfolio(context.Background(), portfolioID); err != nil {
		t.Fatalf("EnsurePortfolio() error = %v", err)
	}
}

func TestEnsurePortfolioRejectsNonDefaultPortfolio(t *testing.T) {
	service := NewService(fakeRepository{scope: Scope{WorkspaceID: uuid.New(), PortfolioID: uuid.MustParse("11111111-1111-1111-1111-111111111111")}})

	err := service.EnsurePortfolio(context.Background(), uuid.MustParse("22222222-2222-2222-2222-222222222222"))
	if !errors.Is(err, ErrPortfolioNotAllowed) {
		t.Fatalf("EnsurePortfolio() error = %v, want ErrPortfolioNotAllowed", err)
	}
}

func TestEnsurePortfolioPreservesDefaultPortfolioLookupError(t *testing.T) {
	service := NewService(fakeRepository{err: ErrNotFound})

	err := service.EnsurePortfolio(context.Background(), uuid.New())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("EnsurePortfolio() error = %v, want ErrNotFound", err)
	}
}

type fakeRepository struct {
	scope Scope
	err   error
}

func (r fakeRepository) DefaultScope(context.Context) (Scope, error) {
	return r.scope, r.err
}
