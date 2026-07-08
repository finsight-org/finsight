.PHONY: dev dev-api dev-web dev-down seed-demo test web-build

dev:
	docker compose up --build -d
	@if [ ! -d apps/web/node_modules ]; then pnpm install; fi
	@trap 'docker compose down' INT TERM EXIT; pnpm -C apps/web dev --host 0.0.0.0

dev-api:
	docker compose up --build

dev-web:
	@if [ ! -d apps/web/node_modules ]; then pnpm install; fi
	pnpm -C apps/web dev --host 0.0.0.0

dev-down:
	docker compose down

seed-demo:
	cd apps/api && FINSIGHT_DATABASE_URL=$${FINSIGHT_DATABASE_URL:-postgres://finsight:finsight@localhost:5432/finsight?sslmode=disable} go run ./cmd/finsight-seed-demo

test:
	cd apps/api && go test ./...
	pnpm -C apps/web test

web-build:
	pnpm -C apps/web build
