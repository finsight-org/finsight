package bootstrap

import (
	"context"
	"fmt"

	"github.com/finsight-org/finsight/apps/api/internal/identity"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
)

const (
	localWorkspaceName         = "Local Workspace"
	localWorkspaceAuthMode     = "local"
	localWorkspaceBaseCurrency = "CAD"
	localUserEmail             = "local@finsight.local"
	localUserDisplayName       = "Local User"
	localMembershipRole        = "owner"
	localPortfolioName         = "Default Portfolio"
)

type Repository interface {
	BootstrapLocal(context.Context, LocalDefaults) (Result, error)
}

type Service struct {
	repository Repository
}

type LocalDefaults struct {
	WorkspaceName         string
	WorkspaceAuthMode     string
	WorkspaceBaseCurrency string
	UserEmail             string
	UserDisplayName       string
	MembershipRole        string
	PortfolioName         string
}

type Result struct {
	Created    bool
	User       identity.User
	Workspace  identity.Workspace
	Membership identity.WorkspaceMembership
	Portfolio  portfolio.Portfolio
}

func NewService(repository Repository) Service {
	return Service{repository: repository}
}

func (s Service) BootstrapLocal(ctx context.Context) (Result, error) {
	if s.repository == nil {
		return Result{}, fmt.Errorf("bootstrap repository is required")
	}

	result, err := s.repository.BootstrapLocal(ctx, LocalDefaults{
		WorkspaceName:         localWorkspaceName,
		WorkspaceAuthMode:     localWorkspaceAuthMode,
		WorkspaceBaseCurrency: localWorkspaceBaseCurrency,
		UserEmail:             localUserEmail,
		UserDisplayName:       localUserDisplayName,
		MembershipRole:        localMembershipRole,
		PortfolioName:         localPortfolioName,
	})
	if err != nil {
		return Result{}, fmt.Errorf("bootstrap local context: %w", err)
	}

	return result, nil
}
