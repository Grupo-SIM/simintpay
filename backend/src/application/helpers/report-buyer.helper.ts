import { Prisma } from '@prisma/client';

/** Buyer identity in reports: CPF digits only; unidentified sales do not add buyers. */
export function reportBuyerCpf(document: string | null | undefined): string | null {
  const digits = (document ?? '').replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

export function reportBuyerCpfSql(document: Prisma.Sql): Prisma.Sql {
  const digits = Prisma.sql`regexp_replace(coalesce(${document}, ''), '[^0-9]', '', 'g')`;
  return Prisma.sql`CASE WHEN length(${digits}) = 11 THEN ${digits} ELSE NULL END`;
}
