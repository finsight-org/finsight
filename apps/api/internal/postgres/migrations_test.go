package postgres

import (
	"context"
	"strings"
	"testing"
	"testing/fstest"
)

func TestRunMigrationsReturnsPingError(t *testing.T) {
	err := RunMigrations(
		context.Background(),
		"postgres://finsight:finsight@127.0.0.1:1/finsight?sslmode=disable",
		fstest.MapFS{},
	)
	if err == nil {
		t.Fatal("RunMigrations() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "ping migration database") {
		t.Fatalf("RunMigrations() error = %q, want ping migration database", err.Error())
	}
}
