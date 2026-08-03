package startup

import (
	"context"
	"fmt"

	"github.com/finsight-org/finsight/apps/api/internal/bootstrap"
	"github.com/finsight-org/finsight/apps/api/internal/config"
)

type Migrator interface {
	Migrate(context.Context) error
}

type LocalBootstrapper interface {
	BootstrapLocal(context.Context) (bootstrap.Result, error)
}

type Service struct {
	migrator       Migrator
	localBootstrap LocalBootstrapper
	deploymentMode config.DeploymentMode
}

func New(migrator Migrator, localBootstrap LocalBootstrapper, deploymentMode config.DeploymentMode) Service {
	return Service{
		migrator:       migrator,
		localBootstrap: localBootstrap,
		deploymentMode: deploymentMode,
	}
}

func (s Service) Initialize(ctx context.Context) error {
	if s.migrator == nil {
		return fmt.Errorf("startup migrator is required")
	}
	if err := s.migrator.Migrate(ctx); err != nil {
		return fmt.Errorf("run startup migrations: %w", err)
	}

	switch s.deploymentMode {
	case config.DeploymentModeManaged:
		return nil
	case config.DeploymentModeLocal:
		if s.localBootstrap == nil {
			return fmt.Errorf("local startup bootstrapper is required")
		}
		if _, err := s.localBootstrap.BootstrapLocal(ctx); err != nil {
			return fmt.Errorf("bootstrap local startup data: %w", err)
		}
		return nil
	default:
		return fmt.Errorf("unsupported deployment mode %q", s.deploymentMode)
	}
}
