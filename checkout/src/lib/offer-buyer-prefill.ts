import { maskCpfCnpj, maskPhoneBr, onlyDigits } from './input-masks';

export interface BuyerPrefill {
  name: string;
  email: string;
  document: string;
  phone: string;
}

/** Remove o DDI 55 de telefones com 12-13 dígitos (ex.: 5583999999999). */
function withoutCountryCode(value: string): string {
  const digits = onlyDigits(value);
  return digits.length >= 12 && digits.startsWith('55')
    ? digits.slice(2)
    : digits;
}

/** Dados do comprador vindos da query (`name`, `email`, `document`, `phone`), já formatados. */
export function buyerPrefillFromQuery(params: URLSearchParams): BuyerPrefill {
  return {
    name: params.get('name')?.trim() ?? '',
    email: params.get('email')?.trim() ?? '',
    document: maskCpfCnpj(params.get('document') ?? ''),
    phone: maskPhoneBr(withoutCountryCode(params.get('phone') ?? '')),
  };
}
