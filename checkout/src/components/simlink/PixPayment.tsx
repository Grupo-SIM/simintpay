'use client';
import { SIM_API_URL } from '@/lib/api-config';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cx } from '@/utils/cx';
import {
  GLASS,
  Spinner,
  SummaryRow,
  formatCurrency,
  useCountdown,
} from '@/components/checkout/ui';

export const SIM_API = SIM_API_URL;

const PIX_STEPS = [
  'Abra o app do seu banco',
  'Escolha Pix copia e cola ou QR Code',
  'Confirme — esta tela atualiza sozinha',
];

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText)
    return navigator.clipboard.writeText(text);
  // Fallback (webviews/HTTP sem Clipboard API)
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error('copy failed'));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * PIX gerado (telas 3a mobile / 5f desktop).
 * `embedded` = versão empilhada usada dentro do card de upsell/downsell (mesmo layout em qualquer largura).
 * Retorna fragmento: o pai deve ser um flex-col com gap.
 */
export function PixDisplay({
  pixContent,
  qrCode,
  pixExpire,
  amount,
  embedded,
}: {
  pixContent: string | null;
  qrCode: string | null;
  pixExpire: string | null;
  amount?: number;
  embedded?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const countdown = useCountdown(pixExpire);

  function handleCopy() {
    if (!pixContent) return;
    copyText(pixContent)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => {
        /* o código continua selecionável na caixa */
      });
  }

  const expiry = pixExpire ? (
    <div
      className={cx(
        'flex items-center gap-2 text-sm text-[#d9d4e3]',
        !embedded && 'lg:text-[15px]',
      )}
    >
      <span className="text-[#a9a3b8]">
        {countdown ? 'Expira em' : 'Válido até'}
      </span>
      <span className="font-semibold tabular-nums text-[#f6b67a]">
        {countdown ?? pixExpire}
      </span>
    </div>
  ) : null;

  const copyButton = pixContent ? (
    <button
      type="button"
      onClick={handleCopy}
      className="sp2-cta h-[54px] w-full text-base"
    >
      {copied ? (
        <Check className="h-4 w-4" strokeWidth={2} />
      ) : (
        <Copy className="h-4 w-4" strokeWidth={2} />
      )}
      {copied ? 'Código copiado!' : 'Copiar código PIX'}
    </button>
  ) : null;

  const waiting = (
    <div className="flex items-center justify-center gap-2.5 text-sm text-[#a9a3b8]">
      <Spinner size={16} width={3} />
      Aguardando pagamento…
    </div>
  );

  if (embedded) {
    return (
      <div className="flex w-full flex-col items-center gap-3.5">
        {qrCode && (
          <div className="h-[200px] w-[200px] rounded-[22px] bg-[#f4f2f7] p-3.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrCode}
              alt="QR Code PIX"
              className="h-full w-full rounded-[10px] object-contain"
            />
          </div>
        )}
        {expiry}
        {pixContent && (
          <div className="w-full select-all overflow-hidden text-ellipsis whitespace-nowrap rounded-2xl border border-white/[0.06] bg-black/25 px-3.5 py-3 font-mono text-xs text-[#c8c2d4]">
            {pixContent}
          </div>
        )}
        {copyButton}
        {waiting}
      </div>
    );
  }

  return (
    <>
      <div
        className={cx(
          'flex flex-col items-center gap-3.5 rounded-[28px] p-5 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-8 lg:p-8',
          GLASS,
        )}
      >
        <div className="flex flex-col items-center gap-3.5">
          {amount != null && (
            <div className="text-center lg:hidden">
              <div className="text-sm text-[#a9a3b8]">Valor</div>
              <div className="text-[32px] font-semibold tabular-nums">
                {formatCurrency(amount)}
              </div>
            </div>
          )}
          {qrCode && (
            <div className="h-[200px] w-[200px] rounded-[22px] bg-[#f4f2f7] p-3.5 lg:h-[260px] lg:w-[260px] lg:rounded-[24px] lg:p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrCode}
                alt="QR Code PIX"
                className="h-full w-full rounded-[10px] object-contain lg:rounded-xl"
              />
            </div>
          )}
          {expiry}
        </div>
        <div className="flex w-full flex-col gap-3.5 lg:gap-4">
          <div className="hidden lg:block">
            <div className="text-2xl font-medium">
              Escaneie ou copie o código
            </div>
            <div className="mt-1 text-sm text-[#a9a3b8]">
              Abra o app do seu banco e escolha pagar com Pix
            </div>
          </div>
          {pixContent && (
            <div className="w-full select-all overflow-hidden text-ellipsis whitespace-nowrap rounded-2xl border border-white/[0.06] bg-black/25 px-3.5 py-3 font-mono text-xs text-[#c8c2d4] lg:whitespace-normal lg:break-all lg:px-4 lg:py-3.5 lg:text-[13px] lg:leading-normal">
              {pixContent}
            </div>
          )}
          {copyButton}
          <div className="hidden flex-col lg:flex">
            {PIX_STEPS.map((s, i) => (
              <SummaryRow
                key={s}
                label={`${i + 1} · ${s}`}
                last={i === PIX_STEPS.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
      <div className={cx('rounded-[24px] px-4 py-1.5 lg:hidden', GLASS)}>
        {PIX_STEPS.map((s, i) => (
          <div
            key={s}
            className={cx(
              'flex items-center gap-3 py-3 text-sm text-[#d9d4e3]',
              i < PIX_STEPS.length - 1 &&
                'border-b border-dashed border-white/[0.12]',
            )}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.12] text-xs">
              {i + 1}
            </span>
            {s}
          </div>
        ))}
      </div>
      <div className="lg:hidden">{waiting}</div>
    </>
  );
}

/**
 * Acompanha a confirmação de um PIX (SSE com fallback de status + reconexão exponencial).
 * Chama `onConfirmed` uma única vez quando o pagamento é COMPLETED.
 */
export function usePixConfirmation(
  pixDomId: string | null,
  confirmed: boolean,
  onConfirmed: () => void,
) {
  useEffect(() => {
    if (!pixDomId || confirmed) return;

    let done = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1500;

    const handleCompleted = () => {
      if (done) return;
      done = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
      onConfirmed();
    };

    const checkStatusFallback = async () => {
      if (done) return;
      try {
        const r = await fetch(`${SIM_API}/checkout/pix/${pixDomId}/status`);
        if (r.ok) {
          const d = await r.json();
          if (d.status === 'COMPLETED') handleCompleted();
        }
      } catch {
        /* ignore */
      }
    };

    const connect = () => {
      if (done) return;
      es = new EventSource(`${SIM_API}/checkout/pix/${pixDomId}/sse`);
      es.addEventListener('payment-status', (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data);
          if (d.status === 'COMPLETED') handleCompleted();
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('heartbeat', () => {
        retryDelay = 1500;
      });
      es.onerror = () => {
        es?.close();
        es = null;
        if (done) return;
        void checkStatusFallback();
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 8000);
          connect();
        }, retryDelay);
      };
    };

    connect();

    return () => {
      done = true;
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
    // onConfirmed é intencionalmente fora das deps: a conexão vive enquanto o id não muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixDomId, confirmed]);
}
