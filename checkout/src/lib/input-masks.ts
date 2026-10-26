/** Apenas dígitos, limitado a `max` caracteres */
export function onlyDigits(value: string, max?: number): string {
  const d = value.replace(/\D/g, '');
  return max != null ? d.slice(0, max) : d;
}

/** CPF (11) ou CNPJ (14) com pontuação progressiva */
export function maskCpfCnpj(value: string): string {
  const digits = onlyDigits(value, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Celular / fixo BR: (00) 00000-0000 ou (00) 0000-0000 */
export function maskPhoneBr(value: string): string {
  const d = onlyDigits(value, 11);
  if (!d.length) return '';
  if (d.length <= 2) return `(${d}`;
  const dd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${dd}) ${rest}`;
  if (d.length <= 10) {
    return `(${dd}) ${rest.slice(0, 4)}-${rest.slice(4, 8)}`;
  }
  return `(${dd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
}

/** Número do cartão em grupos de 4 (até 19 dígitos) */
export function maskCardNumber(value: string): string {
  const d = onlyDigits(value, 19);
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

/** Mês de validade 01–12 */
export function maskCardMonth(value: string): string {
  const d = onlyDigits(value, 2);
  if (!d) return '';
  if (d.length === 1) {
    const n = parseInt(d, 10);
    if (n > 1) return `0${n}`;
    return d;
  }
  let m = parseInt(d, 10);
  if (m > 12) m = 12;
  if (m < 1) m = 1;
  return String(m).padStart(2, '0');
}

/** Ano AA (2 dígitos) */
export function maskCardYear(value: string): string {
  return onlyDigits(value, 2);
}

/** CVV — até 4 dígitos (ex.: Amex) */
export function maskCvv(value: string): string {
  return onlyDigits(value, 4);
}

/** Data de nascimento DD/MM/AAAA (quando o formulário tiver o campo) */
export function maskDateBr(value: string): string {
  const d = onlyDigits(value, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
