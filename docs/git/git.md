# Git Workflow Guidelines

Use this file when creating branches, commits, staging files, or preparing a
clean review diff.

## Branch Names

Use lowercase, descriptive branch names. Prefer these prefixes:

- `docs/<description>` for documentation-only changes.
- `feature/<description>` for new user-facing behavior.
- `fix/<description>` for bug fixes.
- `refactor/<description>` for scoped refactors.
- `test/<description>` for test-only work.

Avoid spaces, uppercase letters, and branch names that look like commit hashes.

## Commit Messages

Use a concise imperative subject:

- Start with a capital letter.
- Keep the subject at or under 72 characters.
- Do not end the subject with a period.
- Prefer at least three words.
- Do not use emojis.

Add a body when the change spans multiple concerns or the reason is not obvious.
The body should explain why the change exists, not restate the diff.

## Commit Granularity

Each commit should represent one coherent concern:

- Documentation.
- Backend implementation.
- Frontend implementation.
- OpenAPI contract and regenerated types.
- Database migration and sqlc changes.
- Tests.

Keep generated files in the same commit as the source change that produced them.
Do not mix unrelated cleanup into feature or fix commits.

## Staging

Before staging, inspect the diff and generated files:

```bash
git status --short
git diff --stat
git diff
```

Stage only files required for the requested change. Be careful in dirty working
trees and do not stage unrelated user changes.

## Generated Files

Do not hand-edit generated files:

- `apps/api/internal/openapi/generated`
- `apps/api/internal/postgres/generated`
- `apps/web/src/api/generated`
- `apps/web/src/routeTree.gen.ts`

When source files change, regenerate through the documented workflow:

- OpenAPI: edit `openapi/finsight.yaml`, then run `cd apps/api && go generate ./...`.
- SQL queries: edit `apps/api/internal/postgres/queries`, then run `cd apps/api && go generate ./...`.
- Frontend API types: run `pnpm -C apps/web openapi:gen`.
- Route tree: let TanStack Router generation update `apps/web/src/routeTree.gen.ts`.

## Documentation-Only Changes

Docs-only changes should stay documentation-only. Do not run formatters or
generators that rewrite code unless the documentation explicitly requires it.

For agent instruction documentation changes, update `AGENTS.md` or `README.md`
only when the entry points need to mention the new or changed instructions.
