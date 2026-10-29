# Agent Guidelines

Shared instructions for Codex and Claude Code. Follow the global guidelines and read the project domain rules in [`docs/business-rules.md`](docs/business-rules.md) before implementation or review.

## Agent changes

Any change related to agents (instructions, skills, hooks or configuration) must support at least **Codex and Claude Code**. Keep shared behavior in agent-neutral sources and wire it into both agents; do not implement it for only one. Apply the corresponding change to the template at `/home/hyoretsu/Projects/ts-monorepo` and to the global instructions for both agents in the same task. In the template, put cross-project directives only in the root `AGENTS.md`, not in package-level guidelines. The template is the source of truth when shared rules diverge; preserve each project's actual domain and stack specifics.

## Plans

Only large features executed in Plan mode need a plan. `docs/` is product/domain knowledge; `plans/` is execution history organized by lifecycle:

- `plans/`: only newly created or in-progress plans.
- `plans/done/`: completed plans. Move the plan here when all steps are complete.
- `plans/discarded/`: abandoned, rejected or superseded plans. Record why they were discarded and link a replacement when applicable; never mark them completed just to archive them.

Name plans `NNNN-kebab-slug.md`, using the next sequential number across all three locations; never reuse an archived plan's number. Preserve the filename when moving a plan, update references and relative links, and commit the move with the corresponding completion or discard update. When resuming, read the existing plan wherever it is; if reopened, move it back to `plans/`. After each completed step, update progress and commit that update with the step's changes.
