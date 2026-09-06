package bootstrap

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	database "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
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

type Bootstrapper struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Bootstrapper {
	return &Bootstrapper{pool: pool}
}

func (b *Bootstrapper) BootstrapLocal(ctx context.Context) error {
	if b == nil || b.pool == nil {
		return fmt.Errorf("postgres pool is required")
	}

	tx, err := b.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin local bootstrap transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	queries := database.New(tx)
	userID, err := queries.UpsertLocalUser(ctx, database.UpsertLocalUserParams{
		Email:       localUserEmail,
		DisplayName: localUserDisplayName,
	})
	if err != nil {
		return fmt.Errorf("upsert local user: %w", err)
	}

	workspaceID, err := queries.UpsertLocalWorkspace(ctx, database.UpsertLocalWorkspaceParams{
		Name:         localWorkspaceName,
		BaseCurrency: localWorkspaceBaseCurrency,
		AuthMode:     localWorkspaceAuthMode,
	})
	if err != nil {
		return fmt.Errorf("upsert local workspace: %w", err)
	}

	if err := queries.UpsertLocalWorkspaceMembership(ctx, database.UpsertLocalWorkspaceMembershipParams{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Role:        localMembershipRole,
	}); err != nil {
		return fmt.Errorf("upsert local workspace membership: %w", err)
	}

	if err := queries.UpsertDefaultPortfolio(ctx, database.UpsertDefaultPortfolioParams{
		WorkspaceID:  workspaceID,
		Name:         localPortfolioName,
		BaseCurrency: localWorkspaceBaseCurrency,
	}); err != nil {
		return fmt.Errorf("upsert default portfolio: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit local bootstrap transaction: %w", err)
	}
	return nil
}
