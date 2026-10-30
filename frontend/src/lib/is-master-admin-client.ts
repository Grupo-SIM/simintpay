/**
 * Igual ao back (`isMasterAdminUser`): só ADMIN; master vem de GET /auth/me (`isMasterAdmin`)
 * ou, se a API ainda não mandar o campo, slug/nome do tenant com "master" (como fallback).
 * E-mails em MASTER_ADMIN_EMAILS só entram via resposta do servidor em `isMasterAdmin`.
 */
export function isMasterAdminClient(
  user:
    | {
        isAdmin?: boolean;
        isMasterAdmin?: boolean;
        tenantModule?: { slug?: string; name?: string } | null;
        modulo?: { slug?: string; name?: string } | null;
      }
    | null
    | undefined,
): boolean {
  if (!user?.isAdmin) return false;
  if (typeof user.isMasterAdmin === 'boolean') {
    return user.isMasterAdmin;
  }
  const slug = (
    user.tenantModule?.slug ??
    user.modulo?.slug ??
    ''
  ).toLowerCase();
  const name = (
    user.tenantModule?.name ??
    user.modulo?.name ??
    ''
  ).toLowerCase();
  return slug.includes('master') || name.includes('master');
}
