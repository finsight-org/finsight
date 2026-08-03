package main

import (
	"strings"
	"testing"
)

func TestRunRejectsManagedDeploymentMode(t *testing.T) {
	t.Setenv("FINSIGHT_DEPLOYMENT_MODE", "managed")

	err := run()
	if err == nil {
		t.Fatal("run() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "demo seeding requires local deployment mode") {
		t.Fatalf("run() error = %q, want local deployment mode error", err)
	}
}
