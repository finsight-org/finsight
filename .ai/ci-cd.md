# CI/CD and Validation Guidelines

Finsight currently relies on local validation commands documented in the
repository. Do not assume GitHub Actions workflow names, jobs, or labels exist
unless they are present in the repository.

## Common Checks

Run the smallest useful check first, then broaden as risk increases.

Full repository:

```bash
make test
make web-build
```

Backend:

```bash
cd apps/api && go test ./...
```

Frontend:

```bash
pnpm -C apps/web typecheck
pnpm -C apps/web test
pnpm -C apps/web build
pnpm -C apps/web test:e2e
```

Development servers:

```bash
make dev
make dev-api
```

## Choosing Checks

- Documentation-only: link and consistency inspection is usually sufficient.
- Backend service or handler changes: run `cd apps/api && go test ./...`.
- OpenAPI changes: regenerate backend and frontend types, then run backend tests
  and frontend typecheck.
- SQL or migration changes: run backend tests and any migration-specific tests.
- Frontend component or route changes: run typecheck, frontend tests, and build.
- End-to-end workflow changes: add or run Playwright tests.

## Investigating Failures

Start with the first meaningful failure, not the longest log.

Check:

- Whether generated files are stale.
- Whether the local database or dev services are required.
- Whether a failure is deterministic by rerunning the narrow command.
- Whether frontend tests are failing on visible behavior or implementation
  details.
- Whether an API contract change requires updates on both backend and frontend
  sides.

If a failure is unrelated to the change, record the evidence clearly before
handing off.

## Reporting

When finishing a change, state:

- Which checks ran.
- Which checks did not run.
- Why omitted checks were not necessary or could not run.
- Any remaining risk.
