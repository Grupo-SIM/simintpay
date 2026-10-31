# Deployment

## Images and runtime

Build from repository root; the Dockerfile lives in `backend/`:

```sh
docker build -f backend/Dockerfile --target runtime -t simintpay:local .
docker build -f backend/Dockerfile --target maintenance -t simintpay-maintenance:local .
```

Bun installs frozen dependencies; Node 22 runs Nest's compiled JavaScript. Runtime is non-root and installs production dependencies only. Bun also installs optional production peers, including Prisma CLI and TypeScript; Nest CLI, Jest and repository tooling stay outside the runtime image. Prisma client is generated during the build without a database connection. The runtime and maintenance images contain Prisma CLI and migration sources; Compose runs `prisma migrate deploy` from the runtime image, so there is no separate migrate image. The runtime image never changes a database on startup.

CI checks main and pull requests. CD runs on pushes to `main` and manual dispatches, rebuilding only the images of affected projects. Each project is published as `ghcr.io/<owner>/<repository>_<project>` (`_backend`, `_checkout`, `_frontend`) with `latest` and immutable `sha-<full commit>` tags. The maintenance image is not published; build it locally from the release commit. No workflow deploys services, migrates databases or seeds accounts; migrations run on the server through Compose (see below).

## Production configuration

Copy `.env.production.example` to `.env` on the deployment host. Replace every placeholder and add the integration, SMTP and object-storage settings needed by that installation. Never commit real credentials. The previous Compose file embedded credentials; rotate those credentials separately and remove obsolete copies from deployment systems. Git history still contains the old file.

`compose.production.yaml` uses existing PostgreSQL, Redis and RabbitMQ services reachable from its network. Specify hostnames that resolve from the API container. Existing Swarm-only service names may require an explicitly configured external network; this standalone Compose configuration does not recreate Swarm/Traefik routing.

The existing `back-simpay_simpay_storage` external volume is preserved by default and mounted at `/app/backend/storage`. Override `STORAGE_VOLUME_NAME` for another installation. Ensure the volume is writable by Node UID 1000 before rollout. Host binding is loopback-only at port 3333; configure the host reverse proxy separately. Container health probes Swagger JSON on that port.

## Explicit release steps

Review environment and backup policy first. The following commands are operator instructions, never agent-authorized remote actions:

```sh
docker compose -f compose.production.yaml pull
docker compose -f compose.production.yaml up -d
```

`compose.production.yaml` runs a one-shot `migrate` service (the same `_backend` image) that executes `prisma migrate deploy` in `backend/` before the API starts. `api` depends on it with `service_completed_successfully`, so a failed migration aborts `up` and keeps the previous containers running. `BACKEND_IMAGE`, `MIGRATE_IMAGE` and `FRONTEND_IMAGE` override the images and default to `latest`; pin all of them to the same `sha-<full commit>` tag for real rollouts, since the migration must match the API version. Adapt network settings if the database requires a private Docker network.

Migrations run before the new API starts, so the previous version briefly serves traffic against the new schema: keep migrations backward compatible (expand, then contract in a later release). Baseline reconciliation is not automatic: if the database predates Prisma history, `migrate deploy` fails and blocks rollout; verify existing migration history before any `migrate resolve`. Seeding is not part of rollout; use a separately reviewed operation only when needed. Roll back the application by selecting the previous immutable image; schema rollback requires its own reviewed procedure.

## Follow-up improvements

- Introduce explicit readiness/liveness routes that distinguish HTTP readiness from database/broker availability.
- Replace starter E2E test with disposable local PostgreSQL/RabbitMQ/Redis integration coverage.
- Extract shared SQL/domain packages when a second application consumes their contracts.
- Pin workflow actions and container base images to digests under an update policy.
- Audit old operational scripts and tracked scratch files before retiring them.

## Checkout workspace

Build from repository root:

```sh
docker build -f checkout/Dockerfile -t simintpay-checkout:local \
  --build-arg NEXT_PUBLIC_SIM_API_URL=https://YOUR_BACKEND_HOST \
  --build-arg NEXT_PUBLIC_API_PAGATG_URL=https://YOUR_PAGATG_HOST \
  --build-arg NEXT_PUBLIC_EBOOK_API_URL=https://YOUR_EBOOK_HOST .
```

Checkout image builds through its Turbo graph, including offline backend OpenAPI export. Backend is a development-only workspace dependency; Next.js standalone tracing includes only required checkout runtime dependencies. Runtime starts `checkout/server.js` as UID 1000 and serves checkout assets on port 3000. No readiness endpoints are added.

CD also publishes `ghcr.io/<owner>/<repository>_checkout` with the same tags. Set repository variables `NEXT_PUBLIC_SIM_API_URL`, `NEXT_PUBLIC_API_PAGATG_URL` and `NEXT_PUBLIC_EBOOK_API_URL` before image publication. They are public build inputs; changing runtime environment does not update browser bundles. Missing values retain the imported application's production defaults.

Set `CHECKOUT_IMAGE` alongside `BACKEND_IMAGE` in production `.env`. Compose binds checkout to `127.0.0.1:3000`; configure its reverse proxy and backend CORS separately. Checkout-only updates use `docker compose -f compose.production.yaml up -d checkout`. No command here authorizes an agent to publish or deploy.
