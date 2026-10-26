# Deployment

## Images and runtime

Build from repository root; the Dockerfile lives in `backend/`:

```sh
docker build -f backend/Dockerfile --target runtime -t simintpay:local .
docker build -f backend/Dockerfile --target maintenance -t simintpay-maintenance:local .
```

Bun installs frozen dependencies; Node 22 runs Nest's compiled JavaScript. Runtime is non-root and installs production dependencies only. Bun also installs optional production peers, including Prisma CLI and TypeScript; Nest CLI, Jest and repository tooling stay outside the runtime image. Prisma client is generated during the build without a database connection. Maintenance image contains Prisma CLI and migration sources. Neither image changes a database on startup.

CI checks main and pull requests. CD publishes immutable `sha-<full commit>` runtime tags at `ghcr.io/<owner>/<repository>` and maintenance tags at `ghcr.io/<owner>/<repository>-maintenance`. CD checks out the validated commit and publishes only trusted main push runs or manual dispatches. No workflow deploys services, migrates databases or seeds accounts.

## Production configuration

Copy `.env.production.example` to `.env` on the deployment host. Replace every placeholder and add the integration, SMTP and object-storage settings needed by that installation. Never commit real credentials. The previous Compose file embedded credentials; rotate those credentials separately and remove obsolete copies from deployment systems. Git history still contains the old file.

`compose.production.yaml` uses existing PostgreSQL, Redis and RabbitMQ services reachable from its network. Specify hostnames that resolve from the API container. Existing Swarm-only service names may require an explicitly configured external network; this standalone Compose configuration does not recreate Swarm/Traefik routing.

The existing `back-simpay_simpay_storage` external volume is preserved by default and mounted at `/app/backend/storage`. Override `STORAGE_VOLUME_NAME` for another installation. Ensure the volume is writable by Node UID 1000 before rollout. Host binding is loopback-only at port 3333; configure the host reverse proxy separately. Container health probes Swagger JSON on that port.

## Explicit release steps

Review environment and backup policy first. The following commands are operator instructions, never agent-authorized remote actions:

```sh
# Maintenance operation: changes the configured database. Run once per release,
# after approval, with the exact same commit as the runtime image.
docker run --rm --env-file .env \
  ghcr.io/OWNER/REPOSITORY-maintenance:sha-COMMIT migrate deploy

# Only after migration succeeds:
docker compose -f compose.production.yaml up -d
```

Adapt container network flags if the database requires a private Docker network. Baseline reconciliation is not automatic: verify existing migration history before any `migrate resolve`. Seeding is not part of rollout; use a separately reviewed operation only when needed. A failed migration blocks rollout. Roll back the application by selecting the previous immutable image; schema rollback requires its own reviewed procedure.

## Follow-up improvements

- Introduce explicit readiness/liveness routes that distinguish HTTP readiness from database/broker availability.
- Replace starter E2E test with disposable local PostgreSQL/RabbitMQ/Redis integration coverage.
- Extract shared SQL/domain packages when a second application consumes their contracts.
- Pin workflow actions and container base images to digests under an update policy.
- Audit old operational scripts and tracked scratch files before retiring them.
