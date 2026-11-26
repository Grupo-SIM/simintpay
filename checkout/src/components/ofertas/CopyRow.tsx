'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }
  return (
    <div className="w-full">
      <p className="mb-1 text-xs text-zinc-400">{label}</p>
      <div className="flex items-stretch gap-2">
        <div className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
          <p className="select-all break-all text-xs text-zinc-300">{value}</p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center justify-center rounded-lg border border-[rgba(246,182,122,.35)] bg-[rgba(245,138,42,.12)] px-3 text-[#d9d4e3] transition hover:bg-[rgba(245,138,42,.2)]"
          aria-label="Copiar"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
