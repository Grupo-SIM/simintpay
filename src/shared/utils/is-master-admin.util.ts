function masterAdminEmailsFromEnv(): Set<string> {
  const raw = process.env.MASTER_ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Admin “master” — guards, GET /auth/me, etc.
 * - MASTER_ADMIN_EMAILS: e-mails separados por vírgula (ou espaço).
 * - Ou slug/nome do tenant contendo "master" (case insensitive).
 */
export function isMasterAdminUser(user: {
  role: string;
  email?: string | null;
  tenantModule?: { slug?: string | null; name?: string | null } | null;
}): boolean {
  if (user.role !== 'ADMIN') return false;
  const mail = (user.email ?? '').trim().toLowerCase();
  if (mail && masterAdminEmailsFromEnv().has(mail)) return true;
  const slug = (user.tenantModule?.slug ?? '').toLowerCase();
  const name = (user.tenantModule?.name ?? '').toLowerCase();
  return slug.includes('master') || name.includes('master');
}
