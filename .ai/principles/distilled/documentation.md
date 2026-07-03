# Documentation Principles

## Source Of Truth

Finsight's source-of-truth documentation lives in:

- `docs/vision.md`
- `docs/mvp.md`
- `docs/use-cases.md`
- `docs/domain-model.md`
- `docs/architecture.md`
- `docs/technical-direction.md`
- implementation guides under `docs/`
- `AGENTS.md` for AI coding agent rules

`.ai/` files summarize and route agent behavior. They do not replace the source
documents.

## When To Update Docs

Update documentation when a change affects:

- Product scope or user workflows.
- Domain concepts or financial model assumptions.
- Architecture or dependency boundaries.
- API contracts or regeneration workflows.
- Database migration or access workflows.
- Frontend organization, i18n, UI, or test expectations.
- AI coding agent expectations.

Do not update docs for unrelated implementation details or speculative future
work.

## Avoid Duplication

Link to source docs instead of copying large sections. Summaries are acceptable
when they help agents choose the right file or rule quickly.

If two docs say different things, update the source-of-truth doc first, then
update summaries and references.

## Markdown Quality

- Use clear headings and short bullets.
- Keep links relative within the repository.
- Avoid stale examples and unsupported commands.
- For docs-only changes, verify links and consistency with nearby documents.
