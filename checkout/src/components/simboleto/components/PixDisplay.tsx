'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function PixDisplay({
  pixContent,
  qrCode,
  pixExpire,
}: {
  pixContent: string | null;
  qrCode: string | null;
  pixExpire: string | null;
}) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (!pixContent) return;
    navigator.clipboard.writeText(pixContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <p className="text-center text-sm font-semibold text-zinc-100">
        PIX gerado com sucesso!
      </p>
      {qrCode && (
        <div className="flex flex-col items-center gap-1">
          <p className="text-xs text-zinc-400">
            Escaneie o QR Code com seu app de pagamentos
          </p>
          <div className="rounded-xl border border-white/15 bg-white p-3 shadow-lg shadow-black/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrCode}
              alt="QR Code PIX"
              className="h-44 w-44 object-contain"
            />
          </div>
          <p className="text-xs text-zinc-500">
            ou use o código Copia e Cola abaixo
          </p>
        </div>
      )}
      {pixContent && (
        <>
          <div className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
            <p className="select-all break-all text-xs text-zinc-300">
              {pixContent}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[rgba(246,182,122,.35)] bg-[rgba(245,138,42,.12)] px-4 py-2.5 text-sm font-semibold text-[#d9d4e3] transition hover:bg-[rgba(245,138,42,.2)]"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? 'Copiado!' : 'Copiar código PIX'}
          </button>
        </>
      )}
      {pixExpire && (
        <p className="text-center text-xs text-zinc-500">
          Válido até: {pixExpire}
        </p>
      )}
      <p className="text-center text-xs text-zinc-500">
        Aguarde a confirmação do pagamento após pagar.
      </p>
    </div>
  );
}
