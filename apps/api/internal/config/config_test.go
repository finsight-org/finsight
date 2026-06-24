package config

import (
	"os"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	unsetEnv(t,
		"FINSIGHT_ENV",
		"FINSIGHT_HTTP_ADDR",
		"FINSIGHT_SERVICE_NAME",
		"FINSIGHT_VERSION",
		"FINSIGHT_DATABASE_URL",
		"FINSIGHT_READY_TIMEOUT",
	)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.Env != defaultEnv {
		t.Fatalf("Env = %q, want %q", cfg.Env, defaultEnv)
	}
	if cfg.HTTPAddr != defaultHTTPAddr {
		t.Fatalf("HTTPAddr = %q, want %q", cfg.HTTPAddr, defaultHTTPAddr)
	}
	if cfg.ServiceName != defaultServiceName {
		t.Fatalf("ServiceName = %q, want %q", cfg.ServiceName, defaultServiceName)
	}
	if cfg.Version != defaultVersion {
		t.Fatalf("Version = %q, want %q", cfg.Version, defaultVersion)
	}
	if cfg.DatabaseURL != defaultDatabaseURL {
		t.Fatalf("DatabaseURL = %q, want %q", cfg.DatabaseURL, defaultDatabaseURL)
	}
	if cfg.ReadyTimeout != defaultReadyTime {
		t.Fatalf("ReadyTimeout = %s, want %s", cfg.ReadyTimeout, defaultReadyTime)
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	unsetEnv(t, "FINSIGHT_DATABASE_URL")
	t.Setenv("FINSIGHT_DATABASE_URL", "")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want error")
	}
}

func TestLoadParsesReadyTimeout(t *testing.T) {
	unsetEnv(t, "FINSIGHT_READY_TIMEOUT")
	t.Setenv("FINSIGHT_READY_TIMEOUT", "5s")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.ReadyTimeout != 5*time.Second {
		t.Fatalf("ReadyTimeout = %s, want 5s", cfg.ReadyTimeout)
	}
}

func unsetEnv(t *testing.T, names ...string) {
	t.Helper()

	previous := make(map[string]string, len(names))
	present := make(map[string]bool, len(names))
	for _, name := range names {
		value, ok := os.LookupEnv(name)
		if ok {
			previous[name] = value
			present[name] = true
		}
		if err := os.Unsetenv(name); err != nil {
			t.Fatalf("Unsetenv(%q) error = %v", name, err)
		}
	}

	t.Cleanup(func() {
		for _, name := range names {
			if present[name] {
				_ = os.Setenv(name, previous[name])
				continue
			}
			_ = os.Unsetenv(name)
		}
	})
}
