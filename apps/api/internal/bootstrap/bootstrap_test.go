package bootstrap

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/finsight-org/finsight/apps/api/internal/identity"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

func TestBootstrapLocalUsesLocalDefaults(t *testing.T) {
	repository := fakeRepository{
		result: Result{
			Created: true,
			User: identity.User{
				ID:          uuid.MustParse("11111111-1111-1111-1111-111111111111"),
				Email:       localUserEmail,
				DisplayName: localUserDisplayName,
			},
			Workspace: identity.Workspace{
				ID:           uuid.MustParse("22222222-2222-2222-2222-222222222222"),
				Name:         localWorkspaceName,
				BaseCurrency: localWorkspaceBaseCurrency,
				AuthMode:     localWorkspaceAuthMode,
			},
			Membership: identity.WorkspaceMembership{
				ID:          uuid.MustParse("33333333-3333-3333-3333-333333333333"),
				WorkspaceID: uuid.MustParse("22222222-2222-2222-2222-222222222222"),
				UserID:      uuid.MustParse("11111111-1111-1111-1111-111111111111"),
				Role:        localMembershipRole,
			},
			Portfolio: portfolio.Portfolio{
				ID:           uuid.MustParse("44444444-4444-4444-4444-444444444444"),
				WorkspaceID:  uuid.MustParse("22222222-2222-2222-2222-222222222222"),
				Name:         localPortfolioName,
				BaseCurrency: localWorkspaceBaseCurrency,
				IsDefault:    true,
			},
		},
	}
	service := NewService(&repository)

	result, err := service.BootstrapLocal(context.Background())
	if err != nil {
		t.Fatalf("BootstrapLocal() error = %v", err)
	}

	if result.User.ID == uuid.Nil {
		t.Fatal("User.ID = uuid.Nil, want typed domain UUID")
	}
	if !result.Created {
		t.Fatal("Created = false, want true")
	}
	if repository.defaults.WorkspaceName != localWorkspaceName {
		t.Fatalf("WorkspaceName = %q, want %q", repository.defaults.WorkspaceName, localWorkspaceName)
	}
	if repository.defaults.UserEmail != localUserEmail {
		t.Fatalf("UserEmail = %q, want %q", repository.defaults.UserEmail, localUserEmail)
	}
	if repository.defaults.PortfolioName != localPortfolioName {
		t.Fatalf("PortfolioName = %q, want %q", repository.defaults.PortfolioName, localPortfolioName)
	}
}

func TestBootstrapLocalWrapsRepositoryError(t *testing.T) {
	service := NewService(&fakeRepository{err: errors.New("database unavailable")})

	if _, err := service.BootstrapLocal(context.Background()); err == nil {
		t.Fatal("BootstrapLocal() error = nil, want error")
	}
}

type fakeRepository struct {
	defaults LocalDefaults
	result   Result
	err      error
}

func (r *fakeRepository) BootstrapLocal(_ context.Context, defaults LocalDefaults) (Result, error) {
	r.defaults = defaults
	return r.result, r.err
}
