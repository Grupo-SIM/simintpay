'use client';

/**
 * Peças do boleto no checkout de oferta: formulário do endereço do pagador (mesmos campos e
 * máscaras do boleto avulso) e a tela com o boleto gerado (linha digitável com cópia, PDF e
 * vencimento).
 */
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  CheckoutGlassField,
  CheckoutGlassInput,
} from '@/components/checkout/CheckoutFormPrimitives';
import { CopyRow } from '@/components/simboleto/components/CopyRow';
import { maskCep } from '@/lib/input-masks';
import {
  boletoPaymentNotice,
  type BoletoAddressFields,
  type BoletoResult,
} from '@/lib/offer-checkout-model';

export const EMPTY_ADDRESS: BoletoAddressFields = {
  cep: '',
  rua: '',
  numero: '',
  bairro: '',
  cidade: '',
  uf: '',
  complemento: '',
};

export function OfferBoletoAddress({
  value,
  onChange,
}: {
  value: BoletoAddressFields;
  onChange: (next: BoletoAddressFields) => void;
}) {
  const [cepLoading, setCepLoading] = useState(false);
  const set = (patch: Partial<BoletoAddressFields>) =>
    onChange({ ...value, ...patch });

  async function lookupCep(masked: string) {
    const digits = masked.replace(/\D/g, '');
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const d = await r.json();
      if (!d?.erro)
        set({
          cep: masked,
          ...(d.logradouro ? { rua: String(d.logradouro).slice(0, 40) } : {}),
          ...(d.bairro ? { bairro: d.bairro } : {}),
          ...(d.localidade ? { cidade: d.localidade } : {}),
          ...(d.uf ? { uf: d.uf } : {}),
        });
    } catch {
      /* ignore — o comprador preenche manualmente */
    } finally {
      setCepLoading(false);
    }
  }

  return (
    <div
      data-testid="boleto-address"
      className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Endereço do pagador (obrigatório para boleto)
      </p>
      <CheckoutGlassField label="CEP" required>
        <CheckoutGlassInput
          name="cep"
          autoComplete="postal-code"
          placeholder="00000-000"
          value={value.cep}
          inputMode="numeric"
          onChange={(v) => {
            const masked = maskCep(v);
            set({ cep: masked });
            if (masked.replace(/\D/g, '').length === 8) void lookupCep(masked);
          }}
        />
      </CheckoutGlassField>
      {cepLoading && (
        <p className="text-xs text-zinc-500">Buscando endereço pelo CEP…</p>
      )}
      <div className="grid grid-cols-[1fr_5.5rem] gap-3">
        <CheckoutGlassField label="Rua" required>
          <CheckoutGlassInput
            name="rua"
            autoComplete="address-line1"
            placeholder="Logradouro"
            value={value.rua}
            onChange={(v) => set({ rua: v.slice(0, 40) })}
          />
        </CheckoutGlassField>
        <CheckoutGlassField label="Número" required>
          <CheckoutGlassInput
            name="numero"
            placeholder="123"
            value={value.numero}
            onChange={(v) => set({ numero: v })}
            inputMode="numeric"
          />
        </CheckoutGlassField>
      </div>
      <CheckoutGlassField label="Bairro" required>
        <CheckoutGlassInput
          name="bairro"
          placeholder="Bairro"
          value={value.bairro}
          onChange={(v) => set({ bairro: v })}
        />
      </CheckoutGlassField>
      <div className="grid grid-cols-[1fr_4.5rem] gap-3">
        <CheckoutGlassField label="Cidade" required>
          <CheckoutGlassInput
            name="cidade"
            autoComplete="address-level2"
            placeholder="Cidade"
            value={value.cidade}
            onChange={(v) => set({ cidade: v })}
          />
        </CheckoutGlassField>
        <CheckoutGlassField label="UF" required>
          <CheckoutGlassInput
            name="uf"
            autoComplete="address-level1"
            placeholder="SP"
            value={value.uf}
            onChange={(v) =>
              set({
                uf: v
                  .replace(/[^a-zA-Z]/g, '')
                  .toUpperCase()
                  .slice(0, 2),
              })
            }
          />
        </CheckoutGlassField>
      </div>
      <CheckoutGlassField label="Complemento (opcional)">
        <CheckoutGlassInput
          name="complemento"
          autoComplete="address-line2"
          placeholder="Apto, bloco…"
          value={value.complemento ?? ''}
          onChange={(v) => set({ complemento: v })}
        />
      </CheckoutGlassField>
    </div>
  );
}

export function OfferBoletoResult({ boleto }: { boleto: BoletoResult }) {
  return (
    <div
      data-testid="boleto-result"
      className="flex flex-col items-center gap-4 py-2"
    >
      <p className="text-center text-sm font-semibold text-zinc-100">
        Boleto gerado com sucesso!
      </p>
      {boleto.amount !== null && (
        <p data-testid="boleto-amount" className="text-sm text-zinc-300">
          Valor do boleto:{' '}
          <strong className="text-white">
            {boleto.amount.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL',
            })}
          </strong>
        </p>
      )}
      {boleto.url && (
        <a
          href={boleto.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="boleto-pdf"
          className="sp2-cta flex h-auto min-h-[44px] w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition"
        >
          <ExternalLink className="h-4 w-4" />
          Abrir / imprimir boleto
        </a>
      )}
      {boleto.digitableLine && (
        <CopyRow label="Linha digitável" value={boleto.digitableLine} />
      )}
      <p
        data-testid="boleto-notice"
        className="text-center text-xs text-zinc-400"
      >
        {boletoPaymentNotice(boleto.dueDate)}
      </p>
      <p className="text-center text-xs text-zinc-500">
        Após o pagamento, a compensação do boleto pode levar até 2 dias úteis.
        Esta tela atualiza sozinha quando o pagamento for confirmado.
      </p>
    </div>
  );
}
