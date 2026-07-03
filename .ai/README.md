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
  code-review.md
  git.md
  pull-requests.md
```

## How To Use These Files

Use the root playbooks for task-specific work:

- `code-review.md`: review methodology and blocker criteria.
- `git.md`: branch, commit, staging, and generated-file guidance.
- `pull-requests.md`: pull request preparation and validation checklist.

Use `docs/` for product, domain, architecture, and implementation direction.
This directory should stay focused on task-specific agent workflows rather than
duplicating project documentation.

## Relationship To `AGENTS.md`

`AGENTS.md` defines repository-wide rules for AI coding agents. Codex reads
`AGENTS.md` automatically, so it should link to these files when a task needs
more specific context.

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
