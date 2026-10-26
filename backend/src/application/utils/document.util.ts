// Helpers de documento (CPF/CNPJ) compartilhados entre webhooks e provisionamento.

/** Remove tudo que não for dígito. */
export function cleanDocument(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Classifica o documento: 14 dígitos → CNPJ, caso contrário → CPF. */
export function documentType(raw: string | null | undefined): 'CPF' | 'CNPJ' {
  return cleanDocument(raw).length === 14 ? 'CNPJ' : 'CPF';
}

/**
 * Separa o documento em { cpf } ou { cnpj } (já sem máscara) para envio aos
 * backends SaaS. Documento vazio retorna {} (não envia nada).
 */
export function splitDocument(raw: string | null | undefined): { cpf?: string } | { cnpj?: string } {
  const digits = cleanDocument(raw);
  if (!digits) return {};
  return digits.length === 14 ? { cnpj: digits } : { cpf: digits };
}
