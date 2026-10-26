# Shared packages

Future reusable libraries belong here as independent Bun workspaces. Keep application-specific Prisma schema and Nest services in `backend` until another consumer needs them. Extract SQL/domain contracts when reuse warrants a package; do not import backend internals from another application.
