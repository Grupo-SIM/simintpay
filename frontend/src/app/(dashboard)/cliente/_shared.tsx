'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';

/** Valor mínimo aceito pelo backend para qualquer produto do cliente. Mantido em sincronia
 * com CLIENT_MIN_AMOUNT do back-simpay (client-rules.helper.ts); configurável via
 * NEXT_PUBLIC_CLIENT_MIN_AMOUNT (lido em build time, já que é NEXT_PUBLIC_*). */
export const VALOR_MINIMO =
  Number(process.env.NEXT_PUBLIC_CLIENT_MIN_AMOUNT) || 14.99;
export const VALOR_MINIMO_ERRO = `O valor mínimo é R$ ${VALOR_MINIMO.toFixed(2).replace('.', ',')}`;

/** Base do checkout público SimintPay (o cliente nunca vê que é a SimintPay). */
export const CHECKOUT_BASE_URL = (
  process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL ??
  'https://checkout.simintermediacoes.com'
).replace(/\/$/, '');

/** Monta a URL pública de checkout de cada produto. Retorna null quando faltam dados. */
export function checkoutUrlPlano(id: string | null | undefined): string | null {
  return id
    ? `${CHECKOUT_BASE_URL}/?simPlanCode=${encodeURIComponent(id)}`
    : null;
}
export function checkoutUrlLinkPagamento(
  id: string | null | undefined,
): string | null {
  return id
    ? `${CHECKOUT_BASE_URL}/?simLinkCode=${encodeURIComponent(id)}`
    : null;
}
export function checkoutUrlAssinatura(
  code: string | null | undefined,
): string | null {
  return code
    ? `${CHECKOUT_BASE_URL}/?subscriptionLinkCode=${encodeURIComponent(code)}`
    : null;
}
export function checkoutUrlPixPlan(
  linkCode: string | null | undefined,
): string | null {
  return linkCode
    ? `${CHECKOUT_BASE_URL}/?code=${encodeURIComponent(linkCode)}`
    : null;
}
export function checkoutUrlBoleto(
  id: string | null | undefined,
): string | null {
  return id
    ? `${CHECKOUT_BASE_URL}/?simBoletoCode=${encodeURIComponent(id)}`
    : null;
}

/**
 * Célula de "Link" das listagens do cliente.
 * - "Abrir": abre o checkout em nova aba E copia o link (com toast).
 * - Botão de copiar: copia o link (com toast).
 */
export function LinkCell({ url }: { url: string | null }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!url) return <span className="text-zinc-400 dark:text-zinc-500">—</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast({
        type: 'success',
        title: 'Link copiado',
        description: 'O link foi copiado para a área de transferência.',
      });
    } catch {
      toast({
        type: 'error',
        title: 'Erro ao copiar',
        description: 'Não foi possível copiar o link.',
      });
    }
  };

  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <a
        aria-label="Abrir"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => void copy()}
        className="inline-flex min-w-0 max-w-[240px] cursor-pointer items-center gap-1 text-emerald-600 transition-colors hover:text-emerald-500 hover:underline dark:text-emerald-400"
        title="Abrir o link em nova aba (e copiar)"
      >
        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{url}</span>
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        title={copied ? 'Copiado!' : 'Copiar link'}
        aria-label="Copiar link"
        className={
          copied
            ? 'cursor-pointer rounded border border-emerald-500/30 p-1 text-emerald-500 transition-colors'
            : 'cursor-pointer rounded border border-zinc-300 p-1 text-zinc-400 transition-colors hover:text-zinc-600 dark:border-white/20 dark:hover:text-zinc-200'
        }
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Copy className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>
    </span>
  );
}

/** Cliente de API memoizável usado por todas as páginas do portal do cliente. */
export function useClienteApi() {
  return useMemo(
    () =>
      createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () =>
          typeof window !== 'undefined'
            ? localStorage.getItem('access_token')
            : null,
      }),
    [],
  );
}

/** Formata uma string de dígitos para o padrão "1.234,56" enquanto o usuário digita. */
export function formatCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '0,00';
  const normalized = digits.padStart(3, '0');
  const cents = normalized.slice(-2);
  let integer = normalized.slice(0, -2).replace(/^0+(?=\d)/, '');
  if (!integer) integer = '0';
  const integerWithThousands = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${integerWithThousands},${cents}`;
}

/** Converte um número (ex.: 49.9) para o texto exibido no input ("49,90"). */
export function formatCurrencyFromNumber(value: number): string {
  const cents = Math.round(value * 100);
  const digits = String(cents).padStart(3, '0');
  const centsPart = digits.slice(-2);
  let intPart = digits.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intPart},${centsPart}`;
}

/** Converte o texto do input ("1.234,56") em número (1234.56). */
export function parseCurrencyInput(value: string): number {
  return Number(value.replace(/\./g, '').replace(',', '.')) || 0;
}

/** Formata um número como moeda BRL para exibição. */
export function fmtBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
