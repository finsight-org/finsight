API_READY_URL ?= http://localhost:8080/ready

.PHONY: dev dev-api dev-web dev-down init-seed reset-db seed-demo test wait-ready web-build

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

init-seed:
	docker compose up --build -d
	$(MAKE) wait-ready
	$(MAKE) seed-demo

reset-db:
	docker compose down -v --remove-orphans
	docker compose up --build -d

seed-demo:
	cd apps/api && FINSIGHT_DATABASE_URL=$${FINSIGHT_DATABASE_URL:-postgres://finsight:finsight@localhost:5432/finsight?sslmode=disable} go run ./cmd/finsight-seed-demo

wait-ready:
	@for attempt in $$(seq 1 60); do \
		if curl -fsS "$(API_READY_URL)" >/dev/null 2>&1; then \
			echo "API is ready at $(API_READY_URL)"; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "API did not become ready at $(API_READY_URL)" >&2; \
	exit 1

test:
	cd apps/api && go test ./...
	pnpm -C apps/web test

web-build:
	pnpm -C apps/web build
