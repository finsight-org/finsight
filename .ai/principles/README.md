# Finsight Agent Principles

This directory contains compact principles for AI coding agents. The files are
hand-authored summaries of Finsight's source-of-truth documentation.

Finsight does not currently run an automated distillation pipeline. If source
docs change, update the matching principle file in the same documentation
change.

## Structure

```text
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

## Source Of Truth

The source-of-truth documents remain in `docs/` and `AGENTS.md`. These
principles are routing and reminder material for agents.

When a principle conflicts with a source document, follow the source document
and update the principle.
