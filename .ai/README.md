# Finsight AI Instructions

This directory contains modular instruction files for AI coding agents working
in the Finsight repository.

The files are intentionally short and task-focused. They complement
`AGENTS.md`, which remains the main entry point for repository-wide agent
guidance.

## Structure

```text
.ai/
  README.md
  ci-cd.md
  code-review.md
  git.md
    merge-requests.md
  principles/
    README.md
    manifest.yml
    distilled/
      api.md
      architecture.md
      backend.md
      database.md
      documentation.md
      frontend.md
      security.md
      testing.md
```

## How To Use These Files

Use the root playbooks for task-specific work:

- `code-review.md`: review methodology and blocker criteria.
- `git.md`: branch, commit, staging, and generated-file guidance.
- `merge-requests.md`: pull request preparation checklist.
- `ci-cd.md`: validation commands and failure investigation.

Use `principles/distilled/*.md` for implementation guidance by area.
These files summarize the current Finsight docs for agent consumption. They do
not replace the source-of-truth docs in `docs/`.

## Relationship To `AGENTS.md`

`AGENTS.md` defines repository-wide rules for AI coding agents. It should link
to these files when a task needs more specific context.

When guidance conflicts, use this precedence:

1. User instruction in the current task.
2. `AGENTS.md`.
3. Source-of-truth documents in `docs/`.
4. Task-specific `.ai/*.md` file.

If a `.ai` file appears stale, follow the source document in `docs/` and update
the `.ai` summary in the same documentation change.

## Tracking

Finsight does not ignore `.ai/` in `.gitignore`. Shared instruction files in
this directory should be committed normally. Personal local notes should live
outside the repository or in a gitignored local file.
