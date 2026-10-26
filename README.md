# SimIntPay

Payment backend built with NestJS, Prisma and PostgreSQL. Bun manages the workspace and tooling; backend and checkout production run on Node 22.

## Layout

- `backend/`: Nest application, Prisma schema/migrations, operational scripts and tests.
- `checkout/`: Next.js payment checkout, browser assets and payment forms.
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
bun generate
# Explicitly initialize the LOCAL database after checking backend/.env:
(cd backend && bun migrate:deploy)
cp checkout/.env.example checkout/.env.local
bun dev
```

Existing local `.env`, storage and build outputs moved into `backend/` with the application. Review existing environment before starting: old credentials may still point at shared services. Compose never imports those credentials or starts the application automatically.

```sh
bun run build
bun run check-types
bun run test:unit
(cd backend && bun test:watch)
```

Root commands are global Turbo tasks: `bun dev`, `bun build`, `bun start`, `bun generate`, and `bun export`. Select a workspace through Turbo, for example `bun turbo -F checkout dev`. Operational scripts now run from `backend/`, for example `cd backend && bun scripts/configure-delivery-profile.ts`. Their effects are unchanged; inspect the target environment before using them.

## Tooling

One Bun lockfile and workspace graph. Turbo builds/checks affected workspaces; builds generate Prisma before compilation. Lefthook installs on `bun install`, validates Conventional Commits and runs type checks, staged formatting/linting and backend unit tests. Pure renames retain original formatting. Shared formatting uses Bun fmt. Backend retains its existing ESLint/Prettier lint rules; checkout uses Next's flat ESLint configuration. Biome adoption would require a separate source cleanup.

Unit checks run Bun `.test.ts` files in separate processes, then Jest `.spec.ts` suites. Environment credentials are removed and database/broker addresses point at closed loopback ports. Tests under `tests/` remain integration suites and are excluded. Existing end-to-end starter test is obsolete and is not a deployment gate; replace it with disposable-service integration tests before enabling that gate. No test command initializes a database.

CI uses the template's graph-based affected-package detector for type checks, builds and unit tests. Image publication follows successful main-branch CI, or explicit manual dispatch; it never deploys or connects to a database.

## Deployment

See [deployment guide](docs/deployment.md). Production configuration contains no embedded credentials. API startup only starts the server; migrations, baseline reconciliation and seeding require explicit operator actions.

[Business rules](docs/business-rules.md) · [Canonical Delivery integration](docs/guides/delivery-canonical-integration.md)

Checkout setup and public build-time API variables: [checkout guide](checkout/README.md). `bun dev` runs both workspaces. Checkout declares backend as a development dependency; its local Turbo configuration waits for backend OpenAPI export and runs backend dev alongside checkout. `bun turbo -F checkout dev` follows the same dependencies without workspace-specific root aliases. Export runs offline in Nest preview mode and writes `backend/out/openapi.json`.
