# SimIntPay

Payment backend built with NestJS, Prisma and PostgreSQL. Bun manages the workspace and tooling; production runs on Node 22.

## Layout

- `backend/`: Nest application, Prisma schema/migrations, operational scripts and tests.
- `packages/`: future shared libraries; no artificial empty SQL/domain package.
- `scripts/`: workspace validation and test tooling.
- `docs/`: product rules and integration guides.
- `plans/`: existing feature execution history.

## Development

Requires Bun 1.4.4, Node 22 and Docker Compose. Run commands from repository root unless stated otherwise.

```sh
bun install --frozen-lockfile
cp backend/.env.example backend/.env
# Start disposable/local dependencies only:
docker compose up -d
bun run generate
# Explicitly initialize the LOCAL database after checking backend/.env:
bun run --cwd backend migrate:deploy
bun run dev
```

Existing local `.env`, storage and build outputs moved into `backend/` with the application. Review existing environment before starting: old credentials may still point at shared services. Compose never imports those credentials or starts the application automatically.

```sh
bun run build
bun run check-types
bun run test:unit
bun run --cwd backend test:watch
```

Root `start`, `start:dev` and `start:prod` remain available. Operational scripts now run from `backend/`, for example `cd backend && bun scripts/configure-delivery-profile.ts`. Their effects are unchanged; inspect the target environment before using them.

## Tooling

One Bun lockfile and workspace graph. Turbo builds/checks affected workspaces; builds generate Prisma before compilation. Lefthook installs on `bun install`, validates Conventional Commits and runs type checks, staged formatting/linting and backend unit tests. Pure renames retain original formatting. Existing ESLint/Prettier rules remain; adopting the template's entire Biome rule set would require a separate source cleanup.

Unit checks run Bun `.test.ts` files in separate processes, then Jest `.spec.ts` suites. Environment credentials are removed and database/broker addresses point at closed loopback ports. Tests under `tests/` remain integration suites and are excluded. Existing end-to-end starter test is obsolete and is not a deployment gate; replace it with disposable-service integration tests before enabling that gate. No test command initializes a database.

CI uses the template's graph-based affected-package detector for type checks, builds and unit tests. Image publication follows successful main-branch CI, or explicit manual dispatch; it never deploys or connects to a database.

## Deployment

See [deployment guide](docs/deployment.md). Production configuration contains no embedded credentials. API startup only starts the server; migrations, baseline reconciliation and seeding require explicit operator actions.

[Business rules](docs/business-rules.md) · [Canonical Delivery integration](docs/guides/delivery-canonical-integration.md)
