import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** True se a string é um valor monetário negativo (ex.: "-R$ 10,00", "R$ -10,00"). */
export function isNegativeMoneyString(v: string | null | undefined): boolean {
  const s = (v ?? '').trim();
  if (!s.includes('R$')) return false;
  return /^-/.test(s) || /-\s*R\$/.test(s) || /R\$\s*-/.test(s);
}

/** Classe de cor vermelha quando o valor (número OU string formatada) é negativo; "" caso contrário. */
export function negativeMoneyClass(
  v: number | string | null | undefined,
): string {
  const neg =
    typeof v === 'number'
      ? v < 0
      : isNegativeMoneyString(v == null ? '' : String(v));
  return neg ? 'text-red-600 dark:text-red-400' : '';
}

export function formatDocument(doc: string | null | undefined): string {
  if (!doc) return '-';
  const cleanDoc = doc.replace(/\D/g, '');

  if (cleanDoc.length === 11) {
    return cleanDoc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }

  if (cleanDoc.length === 14) {
    return cleanDoc.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      '$1.$2.$3/$4-$5',
    );
  }

  return doc;
}

function isValidCpf(digits: string): boolean {
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    return ((sum * 10) % 11) % 10;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/** Formata chave Pix quando for CPF (válido) ou CNPJ; demais tipos (telefone, e-mail, aleatória) ficam intactos. */
export function formatPixKey(key: string | null | undefined): string {
  if (!key) return '---';
  if (!/^[\d.\-/\s]+$/.test(key)) return key;
  const digits = key.replace(/\D/g, '');
  if (digits.length === 14) return formatDocument(digits);
  if (digits.length === 11 && isValidCpf(digits)) return formatDocument(digits);
  return key;
}

export function formatBRL(v: number | undefined | null): string {
  return (v ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/** Remove marcas internas `[TENANT:TAG]` da descrição apenas para exibição na UI. */
export function formatTransacaoDescricaoUi(
  value: string | null | undefined,
): string {
  if (value == null || value === '') return '';
  return value
    .replace(/\[\s*TENANT\s*:\s*[^\]]+\]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Visual only: never use the marker to assign ownership or mutate a payment. */
export function transacaoPlataformaUi(
  platform: string | null | undefined,
  description: string | null | undefined,
): string | undefined {
  return (
    platform?.trim() ||
    description?.match(/\[\s*TENANT\s*:\s*([^\]]+)\]/i)?.[1].trim() ||
    undefined
  );
}

export function getPlatformBadgeClass(
  plataforma: string | null | undefined,
): string {
  if (!plataforma)
    return 'bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300';
  const k = plataforma.trim().toLowerCase();

  if (
    k.includes('areaflix') ||
    k.includes('área flix') ||
    k.includes('area flix')
  )
    return 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300';
  if (k.includes('pagatg') || k.includes('paga tg'))
    return 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300';
  if (k.includes('ebooksim') || k.includes('ebook') || k.includes('e-book'))
    return 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300';
  if (k.includes('renovada'))
    return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';
  if (k.includes('bosque') || k.includes('ibb'))
    return 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300';
  if (k.includes('revalida'))
    return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300';
  if (k.includes('marketing raiz') || k.includes('marketing-raiz'))
    return 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300';
  if (k.includes('atlas'))
    return 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300';
  if (
    k.includes('zero-grau') ||
    k.includes('zero grau') ||
    k.includes('zerograu')
  )
    return 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300';
  // SimintPay (tag SIMINTPAY ou GLOBAL) — cor da marca, para o badge "Sim Int Pay".
  if (k === 'simintpay' || k === 'sim int pay' || k === 'global')
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300';

  // Dynamic colors (non-green)
  const colors = [
    'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
    'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300',
    'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
    'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300',
    'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
    'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
    'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300',
    'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
    'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
    'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/20 dark:text-fuchsia-300',
    'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-300',
    'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
  ];

  let hash = 0;
  for (let i = 0; i < k.length; i++) {
    hash = k.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}
