package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"time"
)

const (
	defaultEnv         = "local"
	defaultHTTPAddr    = ":8080"
	defaultServiceName = "finsight-api"
	defaultVersion     = "dev"
	defaultDatabaseURL = "postgres://finsight:finsight@postgres:5432/finsight?sslmode=disable"
	defaultReadyTime   = 2 * time.Second
)

type Config struct {
	Env          string
	HTTPAddr     string
	ServiceName  string
	Version      string
	DatabaseURL  string
	ReadyTimeout time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Env:          envString("FINSIGHT_ENV", defaultEnv),
		HTTPAddr:     envString("FINSIGHT_HTTP_ADDR", defaultHTTPAddr),
		ServiceName:  envString("FINSIGHT_SERVICE_NAME", defaultServiceName),
		Version:      envString("FINSIGHT_VERSION", defaultVersion),
		DatabaseURL:  envString("FINSIGHT_DATABASE_URL", defaultDatabaseURL),
		ReadyTimeout: defaultReadyTime,
	}

	if rawTimeout, ok := os.LookupEnv("FINSIGHT_READY_TIMEOUT"); ok {
		readyTimeout, err := time.ParseDuration(rawTimeout)
		if err != nil {
			return Config{}, fmt.Errorf("parse FINSIGHT_READY_TIMEOUT: %w", err)
		}
		cfg.ReadyTimeout = readyTimeout
	}

	if err := validateDatabaseURL(cfg.DatabaseURL); err != nil {
		return Config{}, err
	}
	if cfg.ReadyTimeout <= 0 {
		return Config{}, errors.New("FINSIGHT_READY_TIMEOUT must be greater than zero")
	}

	return cfg, nil
}

func envString(name, fallback string) string {
	value, ok := os.LookupEnv(name)
	if !ok {
		return fallback
	}
	return value
}

func validateDatabaseURL(databaseURL string) error {
	if databaseURL == "" {
		return errors.New("FINSIGHT_DATABASE_URL is required")
	}

	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return fmt.Errorf("parse FINSIGHT_DATABASE_URL: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("FINSIGHT_DATABASE_URL must include a scheme and host")
	}

	return nil
}
