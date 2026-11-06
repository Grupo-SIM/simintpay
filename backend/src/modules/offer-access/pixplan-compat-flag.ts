/**
 * `OFFER_PIXPLAN_COMPAT=1` troca os controllers do plano PIX legado pelos de compatibilidade
 * apoiados em ofertas. Lido na montagem dos módulos (depois do `dotenv/config` do main.ts), por
 * isso exige reiniciar o processo ao alterar. Padrão: desligado.
 */
export function offerPixPlanCompatEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env.OFFER_PIXPLAN_COMPAT?.trim().toLowerCase();
  return v === '1' || v === 'true';
}
