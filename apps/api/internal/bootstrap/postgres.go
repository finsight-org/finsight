package bootstrap

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/finsight-org/finsight/apps/api/internal/identity"
	"github.com/finsight-org/finsight/apps/api/internal/portfolio"
	db "github.com/finsight-org/finsight/apps/api/internal/postgres/generated"
)

type PostgresRepository struct {
	db *pgxpool.Pool
}

func NewPostgresRepository(db *pgxpool.Pool) PostgresRepository {
	return PostgresRepository{db: db}
}

func (r PostgresRepository) BootstrapLocal(ctx context.Context, defaults LocalDefaults) (Result, error) {
	if r.db == nil {
		return Result{}, fmt.Errorf("postgres pool is required")
	}

	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Result{}, fmt.Errorf("begin bootstrap transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	queries := db.New(tx)

	user, userCreated, err := upsertLocalUser(ctx, queries, defaults)
	if err != nil {
		return Result{}, err
	}
	workspace, workspaceCreated, err := upsertLocalWorkspace(ctx, queries, defaults, user.ID)
	if err != nil {
		return Result{}, err
	}
	membership, membershipCreated, err := upsertLocalMembership(ctx, queries, defaults, workspace.ID, user.ID)
	if err != nil {
		return Result{}, err
	}
	portfolio, portfolioCreated, err := upsertDefaultPortfolio(ctx, queries, defaults, workspace.ID, user.ID)
	if err != nil {
		return Result{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return Result{}, fmt.Errorf("commit bootstrap transaction: %w", err)
	}

	return Result{
		Created:    userCreated || workspaceCreated || membershipCreated || portfolioCreated,
		User:       user,
		Workspace:  workspace,
		Membership: membership,
		Portfolio:  portfolio,
	}, nil
}

func upsertLocalUser(ctx context.Context, queries *db.Queries, defaults LocalDefaults) (identity.User, bool, error) {
	row, err := queries.UpsertLocalUser(ctx, db.UpsertLocalUserParams{
		Email:       defaults.UserEmail,
		DisplayName: defaults.UserDisplayName,
	})
	if err != nil {
		return identity.User{}, false, fmt.Errorf("upsert local user: %w", err)
	}

	id, err := domainUUID(row.ID)
	if err != nil {
		return identity.User{}, false, fmt.Errorf("map local user id: %w", err)
	}

	return identity.User{
		ID:          id,
		Email:       row.Email,
		DisplayName: row.DisplayName,
	}, row.Created, nil
}

func upsertLocalWorkspace(ctx context.Context, queries *db.Queries, defaults LocalDefaults, userID uuid.UUID) (identity.Workspace, bool, error) {
	row, err := queries.UpsertLocalWorkspace(ctx, db.UpsertLocalWorkspaceParams{
		Name:         defaults.WorkspaceName,
		BaseCurrency: defaults.WorkspaceBaseCurrency,
		AuthMode:     defaults.WorkspaceAuthMode,
		UserID:       pgUUID(userID),
	})
	if err != nil {
		return identity.Workspace{}, false, fmt.Errorf("upsert local workspace: %w", err)
	}

	id, err := domainUUID(row.ID)
	if err != nil {
		return identity.Workspace{}, false, fmt.Errorf("map local workspace id: %w", err)
	}

	return identity.Workspace{
		ID:           id,
		Name:         row.Name,
		BaseCurrency: row.BaseCurrency,
		AuthMode:     row.AuthMode,
	}, row.Created, nil
}

func upsertLocalMembership(ctx context.Context, queries *db.Queries, defaults LocalDefaults, workspaceID uuid.UUID, userID uuid.UUID) (identity.WorkspaceMembership, bool, error) {
	row, err := queries.UpsertLocalWorkspaceMembership(ctx, db.UpsertLocalWorkspaceMembershipParams{
		WorkspaceID: pgUUID(workspaceID),
		UserID:      pgUUID(userID),
		Role:        defaults.MembershipRole,
	})
	if err != nil {
		return identity.WorkspaceMembership{}, false, fmt.Errorf("upsert local workspace membership: %w", err)
	}

	id, err := domainUUID(row.ID)
	if err != nil {
		return identity.WorkspaceMembership{}, false, fmt.Errorf("map local workspace membership id: %w", err)
	}
	rowWorkspaceID, err := domainUUID(row.WorkspaceID)
	if err != nil {
		return identity.WorkspaceMembership{}, false, fmt.Errorf("map local workspace membership workspace id: %w", err)
	}
	rowUserID, err := domainUUID(row.UserID)
	if err != nil {
		return identity.WorkspaceMembership{}, false, fmt.Errorf("map local workspace membership user id: %w", err)
	}

	return identity.WorkspaceMembership{
		ID:          id,
		WorkspaceID: rowWorkspaceID,
		UserID:      rowUserID,
		Role:        row.Role,
	}, row.Created, nil
}

func upsertDefaultPortfolio(ctx context.Context, queries *db.Queries, defaults LocalDefaults, workspaceID uuid.UUID, userID uuid.UUID) (portfolio.Portfolio, bool, error) {
	row, err := queries.UpsertDefaultPortfolio(ctx, db.UpsertDefaultPortfolioParams{
		WorkspaceID:  pgUUID(workspaceID),
		Name:         defaults.PortfolioName,
		BaseCurrency: defaults.WorkspaceBaseCurrency,
		UserID:       pgUUID(userID),
	})
	if err != nil {
		return portfolio.Portfolio{}, false, fmt.Errorf("upsert default portfolio: %w", err)
	}

	id, err := domainUUID(row.ID)
	if err != nil {
		return portfolio.Portfolio{}, false, fmt.Errorf("map default portfolio id: %w", err)
	}
	rowWorkspaceID, err := domainUUID(row.WorkspaceID)
	if err != nil {
		return portfolio.Portfolio{}, false, fmt.Errorf("map default portfolio workspace id: %w", err)
	}

	return portfolio.Portfolio{
		ID:           id,
		WorkspaceID:  rowWorkspaceID,
		Name:         row.Name,
		BaseCurrency: row.BaseCurrency,
		IsDefault:    row.IsDefault,
	}, row.Created, nil
}

func pgUUID(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{
		Bytes: [16]byte(value),
		Valid: true,
	}
}

func domainUUID(value pgtype.UUID) (uuid.UUID, error) {
	if !value.Valid {
		return uuid.Nil, fmt.Errorf("uuid is null")
	}
	return uuid.UUID(value.Bytes), nil
}
