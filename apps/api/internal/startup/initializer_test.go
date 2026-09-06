package startup

import (
	"context"
	"errors"
	"testing"

	"github.com/finsight-org/finsight/apps/api/internal/config"
)

func TestInitializeLocalRunsMigrationsBeforeBootstrap(t *testing.T) {
	calls := []string{}
	initializer := New(
		fakeMigrator{calls: &calls},
		fakeLocalBootstrap{calls: &calls},
		config.DeploymentModeLocal,
	)

	if err := initializer.Initialize(context.Background()); err != nil {
		t.Fatalf("Initialize() error = %v", err)
	}
	if len(calls) != 2 || calls[0] != "migrate" || calls[1] != "bootstrap" {
		t.Fatalf("calls = %v, want [migrate bootstrap]", calls)
	}
}

func TestInitializeManagedSkipsBootstrap(t *testing.T) {
	calls := []string{}
	initializer := New(
		fakeMigrator{calls: &calls},
		fakeLocalBootstrap{calls: &calls},
		config.DeploymentModeManaged,
	)

	if err := initializer.Initialize(context.Background()); err != nil {
		t.Fatalf("Initialize() error = %v", err)
	}
	if len(calls) != 1 || calls[0] != "migrate" {
		t.Fatalf("calls = %v, want [migrate]", calls)
	}
}

func TestInitializeStopsWhenMigrationsFail(t *testing.T) {
	calls := []string{}
	initializer := New(
		fakeMigrator{calls: &calls, err: errors.New("migration failed")},
		fakeLocalBootstrap{calls: &calls},
		config.DeploymentModeLocal,
	)

	if err := initializer.Initialize(context.Background()); err == nil {
		t.Fatal("Initialize() error = nil, want error")
	}
	if len(calls) != 1 || calls[0] != "migrate" {
		t.Fatalf("calls = %v, want [migrate]", calls)
	}
}

func TestInitializeReturnsBootstrapFailure(t *testing.T) {
	initializer := New(
		fakeMigrator{},
		fakeLocalBootstrap{err: errors.New("bootstrap failed")},
		config.DeploymentModeLocal,
	)

	if err := initializer.Initialize(context.Background()); err == nil {
		t.Fatal("Initialize() error = nil, want error")
	}
}

type fakeMigrator struct {
	calls *[]string
	err   error
}

func (m fakeMigrator) Migrate(context.Context) error {
	if m.calls != nil {
		*m.calls = append(*m.calls, "migrate")
	}
	return m.err
}

type fakeLocalBootstrap struct {
	calls *[]string
	err   error
}

func (b fakeLocalBootstrap) BootstrapLocal(context.Context) error {
	if b.calls != nil {
		*b.calls = append(*b.calls, "bootstrap")
	}
	return b.err
}
