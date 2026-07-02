.PHONY: dev dev-api dev-web dev-down test web-build

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

test:
	cd apps/api && go test ./...
	pnpm -C apps/web test

web-build:
	pnpm -C apps/web build
