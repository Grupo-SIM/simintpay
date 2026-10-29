import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

/**
 * Saldo sacável de qualquer conta: `max(0, wallet.balance − wallet.lockedBalance)`.
 * Mesma fonte da validação do saque e do resumo de saque (docs/business-rules.md, "Disponibilidade de saque").
 * Plataforma própria, coprodução e afiliado compartilham a mesma carteira; taxas incidem no lançamento, não na leitura.
 * `tenantSlug` é mantido só para compatibilidade com os chamadores.
 */
export async function computeUserNetBalance(
  prisma: PrismaService,
  userId: string,
  tenantSlug?: string | null,
): Promise<number> {
  void tenantSlug;
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return 0;
  return Number(
    Math.max(0, Number(wallet.balance) - Number(wallet.lockedBalance)).toFixed(
      2,
    ),
  );
}
