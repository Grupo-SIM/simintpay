import { PAGATG_API_URL } from '@/lib/api-config';

/** URL do convite do Telegram pelo código do plano (`PX-` ou código externo) + e-mail do cliente. */
export function buildInviteLinkByCodeUrl(
  planCode: string,
  email: string,
  baseUrl: string = PAGATG_API_URL,
): string {
  const params = new URLSearchParams({ planCode, email });
  return `${baseUrl}/group-pages/public/invite-link-by-code?${params}`;
}

/** Convite do Telegram de um plano PIX pelo código `PX-`. */
export async function fetchPixInviteLink(
  pixPlanCode: string,
  email: string,
): Promise<string | null> {
  try {
    const res = await fetch(buildInviteLinkByCodeUrl(pixPlanCode, email));
    if (!res.ok) return null;
    const data = (await res.json()) as { inviteLink?: string };
    return data?.inviteLink ?? null;
  } catch {
    return null;
  }
}
