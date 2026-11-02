'use client';
import { useBuyerMemory } from '@/hooks/use-buyer-memory';
import { useIsDesktop } from '@/hooks/use-is-desktop';
import { BuyerMemoryPreference } from '@/components/checkout/BuyerMemoryPreference';
/**
 * Checkout de link de pagamento (SimLink) — layout "Checkout Novo" em etapas:
 * Pedido → Dados → Forma de pagamento → Cartão | PIX → (PIX gerado) → funil upsell/downsell → sucesso.
 * Mobile segue as telas 390px (4a–4e, 2a–2c, 3a–3d); desktop (lg) segue as 1280px (5a–5f, 6a–6c, 7a–7c).
 * As chamadas de API, tokenização e regras de funil são as mesmas da versão anterior. Ver DESIGN.md.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Clock,
  CreditCard as CreditCardIcon,
  Lock,
  Mail,
  Smartphone,
  X,
} from 'lucide-react';
import { getTokenCard } from '@/components/sdk';
import {
  maskCardMonth,
  maskCardNumber,
  maskCardYear,
  maskCpfCnpj,
  maskCvv,
  maskPhoneBr,
  onlyDigits,
} from '@/lib/input-masks';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import { buildInstallmentLabel } from '@/lib/installment-label';
import { cx } from '@/utils/cx';
import { PixDisplay, SIM_API, usePixConfirmation } from '../PixPayment';
import {
  FunnelOfferScreen,
  OrderBumpCard,
  type BuildCardBody,
  type LinkOffers,
} from '../LinkOffers';
import {
  CheckDot,
  CtaButton,
  DesktopHeader,
  ErrorBox,
  Field,
  GLASS,
  LG_GLASS,
  Logo,
  MobileProgress,
  MobileTopBar,
  ProductImage,
  ProtectedPill,
  SM_GLASS,
  Screen,
  Spinner,
  StatusPill,
  SummaryAside,
  SummaryRow,
  formatCurrency,
} from '@/components/checkout/ui';

/** Chave pública do gateway (tokenização de cartão) */
const GATEWAY_PUBLIC_KEY = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';

type InstallmentOption = {
  parcelas: number;
  taxaJurosPlatforma: number;
  valorJurosPlatforma: number;
  taxaDom: number;
  valorTaxaDom: number;
  valorTotal: number;
  valorParcela: number;
  temJuros: boolean;
};

type LinkData = {
  id: string;
  titulo: string;
  descricao: string | null;
  valor: number;
  parcelasMax: number;
  aceitaCartao: boolean;
  aceitaDebito: boolean;
  aceitaPix: boolean;
  ativo: boolean;
  isStandalone: boolean;
  redirectUrl?: string | null;
  opcoesParcelas?: InstallmentOption[];
  valorPix?: number;
  valorDebito?: number;
  platformTag?: string;
  debitFeePercent?: number;
  debitFeeFixed?: number;
  debitTaxaDomPercent?: number;
  debitTaxaDomFixed?: number;
  debitTotalFee?: number;
  debitNetAmount?: number;
  /** Valor do link + order bumps selecionados (base para os valores acima) */
  valorComOfertas?: number;
  ofertas?: LinkOffers;
  /** Capa do produto (opcional — só exibida se o backend enviar) */
  imagemUrl?: string | null;
};

import type { PaymentMethod } from './types';
import { previewLink } from '@/lib/payment-link-preview-adapter';
import type { PaymentLinkPreviewDraft } from '@/lib/payment-link-preview';
import { MethodIcon, PreviewNotice } from './components';
type Step = 'pedido' | 'dados' | 'forma' | 'cartao' | 'pix';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Bandeira para o cartão ilustrado (só visual — a bandeira real vem da tokenização). */
function cardBrandLabel(number: string): string {
  const d = number.replace(/\D/g, '');
  if (
    /^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(
      d,
    )
  )
    return 'ELO';
  if (/^(606282|3841)/.test(d)) return 'HIPERCARD';
  if (/^3[47]/.test(d)) return 'AMEX';
  if (/^4/.test(d)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'MASTERCARD';
  return '';
}

function formatPaidAt(date: Date): string {
  const months = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()} · ${hh}:${mm}`;
}

const PIX_BENEFITS = [
  { Icon: Check, text: 'Aprovação imediata, sem análise' },
  { Icon: Clock, text: 'Código válido por 30 minutos' },
  { Icon: Smartphone, text: 'Pague pelo app de qualquer banco' },
];

export default function SimLinkCheckout({
  previewDraft,
  onPreviewLoaded,
}: {
  previewDraft?: PaymentLinkPreviewDraft;
  onPreviewLoaded?: () => void;
}) {
  const preview = previewDraft !== undefined;
  const router = useRouter();
  const searchParams = useSearchParams();
  const simLinkCode = searchParams.get('simLinkCode');

  const [link, setLink] = useState<LinkData | null>(() =>
    previewDraft ? previewLink(previewDraft) : null,
  );
  const [fetching, setFetching] = useState(!preview);
  const [linkError, setLinkError] = useState('');
  const [mobileStep, setStep] = useState<Step>('pedido');
  const desktop = useIsDesktop();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pixContent, setPixContent] = useState<string | null>(null);
  const [pixQrCode, setPixQrCode] = useState<string | null>(null);
  const [pixExpire, setPixExpire] = useState<string | null>(null);
  const [pixDomId, setPixDomId] = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [paidAt, setPaidAt] = useState<Date | null>(null);

  // Cartão recusado pelo emissor → tela 3d/7c
  const [declined, setDeclined] = useState(false);

  // Validação visível só depois da 1ª tentativa de avançar
  const [showDadosErrors, setShowDadosErrors] = useState(false);
  const [showCardErrors, setShowCardErrors] = useState(false);

  // Order bumps marcados + recálculo de valores no backend
  const [selectedBumps, setSelectedBumps] = useState<string[]>([]);
  const [quoting, setQuoting] = useState(false);
  const quoteSeq = useRef(0);

  // Funil pós-compra (upsell → downsell). "done" = funil encerrado (ou inexistente).
  const [funnelStage, setFunnelStage] = useState<
    'upsell' | 'downsell' | 'done' | null
  >(null);
  const [mainTxId, setMainTxId] = useState<string | null>(null);
  const [cardFinish, setCardFinish] = useState<{
    reference: string;
    redirectUrl: string | null;
  } | null>(null);
  // Ofertas do funil aceitas (para o resumo da tela de sucesso)
  const [acceptedOffers, setAcceptedOffers] = useState<
    { id: string; titulo: string; valor: number }[]
  >([]);

  // Forma de pagamento selecionada
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(() =>
    !previewDraft || previewDraft.methods.pix
      ? 'pix'
      : previewDraft.methods.credit
        ? 'credit'
        : 'debit',
  );

  // Desktop não tem etapas: tudo fica na mesma tela e o envio sempre cai na etapa de pagamento.
  const step: Step = desktop
    ? paymentMethod === 'pix'
      ? 'pix'
      : 'cartao'
    : mobileStep;
  // Etapas visíveis: no desktop (antes do PIX gerado) todas as seções ficam renderizadas.
  const showAll =
    desktop && !(step === 'pix' && Boolean(pixContent || pixQrCode));
  const visible = (s: Step) => showAll || step === s;

  // Dados do cliente
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const buyerMemory = useBuyerMemory(
    { name, email, document, phone },
    (saved) => {
      setName((current) => current || saved.name);
      setEmail((current) => current || saved.email);
      setDocument((current) => current || maskCpfCnpj(saved.document));
      setPhone((current) => current || maskPhoneBr(saved.phone));
    },
  );

  // Parcelas
  const [installments, setInstallments] = useState(1);

  // Cartão
  const [cardNumber, setCardNumber] = useState('');
  const [cardMonth, setCardMonth] = useState('');
  const [cardYear, setCardYear] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [holderName, setHolderName] = useState('');
  const [holderDocument, setHolderDocument] = useState('');

  // Ao confirmar o pagamento (ex.: PIX), abre o redirect em uma NOVA aba — só depois do funil de ofertas.
  useEffect(() => {
    if (
      !preview &&
      paymentConfirmed &&
      funnelStage === 'done' &&
      link?.redirectUrl
    ) {
      window.open(link.redirectUrl, '_blank', 'noopener,noreferrer');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentConfirmed, funnelStage]);

  // Cada etapa começa do topo (no mobile o CTA fica no fim da página)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step, declined, funnelStage]);

  usePixConfirmation(preview ? null : pixDomId, paymentConfirmed, () => {
    if (preview) return;
    setPaymentConfirmed(true);
    setPaidAt(new Date());
    setFunnelStage(link?.ofertas?.upsell ? 'upsell' : 'done');
  });

  useEffect(() => {
    if (preview) {
      onPreviewLoaded?.();
      return;
    }
    if (!simLinkCode) {
      setFetching(false);
      return;
    }
    fetch(`${SIM_API}/links-pagamento/public/${simLinkCode}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Link não encontrado (${r.status})`);
        return r.json();
      })
      .then((data: LinkData) => {
        setLink(data);
        // PIX tem prioridade sempre que disponível
        if (data.aceitaPix) setPaymentMethod('pix');
        else if (data.aceitaCartao) setPaymentMethod('credit');
        else if (data.aceitaDebito) setPaymentMethod('debit');
      })
      .catch((err) =>
        setLinkError(err.message || 'Erro ao carregar link de pagamento'),
      )
      .finally(() => setFetching(false));
  }, [simLinkCode, preview, onPreviewLoaded]);

  /** Marca/desmarca um order bump e recalcula valores e parcelas no backend. */
  async function toggleOrderBump(offerId: string) {
    if (preview || !link) return;
    const previous = selectedBumps;
    const next = previous.includes(offerId)
      ? previous.filter((id) => id !== offerId)
      : [...previous, offerId];
    setSelectedBumps(next);
    const seq = ++quoteSeq.current;
    setQuoting(true);
    try {
      const qs =
        next.length > 0
          ? `?orderBumps=${encodeURIComponent(next.join(','))}`
          : '';
      const r = await fetch(
        `${SIM_API}/links-pagamento/public/${link.id}${qs}`,
      );
      if (!r.ok) throw new Error(`quote ${r.status}`);
      const data: LinkData = await r.json();
      if (seq === quoteSeq.current) setLink(data);
    } catch {
      if (seq === quoteSeq.current) {
        setSelectedBumps(previous);
        setError('Não foi possível adicionar a oferta. Tente novamente.');
      }
    } finally {
      if (seq === quoteSeq.current) setQuoting(false);
    }
  }

  /** Tokeniza de novo o cartão já digitado (tokens são de uso único) para o upsell/downsell. */
  const buildCardBody: BuildCardBody = async () => {
    if (preview) return { error: 'Pagamento desabilitado na prévia.' };
    const tokenRes = await getTokenCard(
      GATEWAY_PUBLIC_KEY,
      {
        name: holderName,
        document: holderDocument.replace(/\D/g, ''),
        number: cardNumber.replace(/\s/g, ''),
        cvv: cardCvv,
        month: cardMonth,
        year: cardYear,
      },
      1,
    );
    if (!tokenRes.token)
      return { error: tokenRes.msgError || 'Erro ao tokenizar cartão' };
    return {
      card: {
        token: tokenRes.token,
        brand: tokenRes.brand,
        bin: tokenRes.bin,
        exp_month: cardMonth,
        exp_year: cardYear,
        cvv: cardCvv,
        holder_name: holderName,
        holder_document: holderDocument.replace(/\D/g, ''),
        number: cardNumber.replace(/\s/g, ''),
      },
    };
  };

  function finishCardPurchase(finish: {
    reference: string;
    redirectUrl: string | null;
  }) {
    if (preview) return;
    if (finish.redirectUrl) {
      window.open(finish.redirectUrl, '_blank', 'noopener,noreferrer');
    }
    router.push(`/payment/success?reference=${finish.reference}`);
  }

  function advanceFunnel(accepted: boolean) {
    if (preview) return;
    // Recusou o upsell e existe downsell → oferece o downsell; senão encerra o funil.
    if (!accepted && funnelStage === 'upsell' && link?.ofertas?.downsell) {
      setFunnelStage('downsell');
      return;
    }
    setFunnelStage('done');
    if (cardFinish) finishCardPurchase(cardFinish);
  }

  async function handleSubmit() {
    if (preview || !link || loading) return;
    setError('');
    setLoading(true);

    try {
      if (paymentMethod === 'pix') {
        const body = {
          customerName: name,
          customerEmail: email,
          customerDocument: document.replace(/\D/g, ''),
          customerPhone: phone.replace(/\D/g, ''),
          documentType:
            document.replace(/\D/g, '').length === 14 ? 'CNPJ' : 'CPF',
          ...(selectedBumps.length > 0 ? { orderBumpIds: selectedBumps } : {}),
        };

        const res = await fetch(
          `${SIM_API}/links-pagamento/public/${link.id}/pix`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );

        const data = await res.json();
        if (!res.ok) {
          setError(data?.message ?? 'Erro ao gerar cobrança PIX');
          return;
        }

        setPixContent(data.pixContent ?? null);
        setPixQrCode(data.qrCode ?? null);
        setPixExpire(data.pixExpire ?? null);
        setMainTxId(data.transactionId ?? data.id ?? null);
        setPixDomId(data.id ?? null);
        return;
      }

      // Crédito ou Débito
      const isDebit = paymentMethod === 'debit';
      const chosenInstallments = isDebit ? 1 : installments;

      const tokenRes = await getTokenCard(
        GATEWAY_PUBLIC_KEY,
        {
          name: holderName,
          document: holderDocument.replace(/\D/g, ''),
          number: cardNumber.replace(/\s/g, ''),
          cvv: cardCvv,
          month: cardMonth,
          year: cardYear,
        },
        chosenInstallments,
      );

      if (!tokenRes.token) {
        setError(tokenRes.msgError || 'Erro ao tokenizar cartão');
        return;
      }

      const body = {
        customerName: name,
        customerEmail: email,
        customerDocument: document.replace(/\D/g, ''),
        customerPhone: phone.replace(/\D/g, ''),
        paymentMethod: isDebit ? 'debit_card' : 'credit_card',
        installments: chosenInstallments,
        ...(selectedBumps.length > 0 ? { orderBumpIds: selectedBumps } : {}),
        card: {
          token: tokenRes.token,
          brand: tokenRes.brand,
          bin: tokenRes.bin,
          exp_month: cardMonth,
          exp_year: cardYear,
          cvv: cardCvv,
          holder_name: holderName,
          holder_document: holderDocument.replace(/\D/g, ''),
          number: cardNumber.replace(/\s/g, ''),
        },
      };

      const res = await fetch(
        `${SIM_API}/links-pagamento/public/${link.id}/charge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        setError(data?.message ?? 'Erro ao processar pagamento');
        return;
      }

      const status = String(data.status ?? '').toUpperCase();
      // Cartão recusado/expirado: não redireciona nem mostra sucesso.
      if (
        [
          'FAILED',
          'REJECTED',
          'EXPIRED',
          'DECLINED',
          'REFUNDED',
          'CHARGEBACK',
        ].includes(status)
      ) {
        setDeclined(true);
        return;
      }

      // Só abre o redirect (nova aba) quando o pagamento está realmente aprovado.
      const approved = ['PAID', 'APPROVED', 'COMPLETED'].includes(status);
      const finish = {
        reference: data.id,
        redirectUrl: approved ? (data.redirectUrl ?? null) : null,
      };

      // Upsell só é oferecido com o pedido principal aprovado (o backend valida de novo).
      if (approved && link.ofertas?.upsell) {
        setMainTxId(data.transactionId ?? data.id);
        setCardFinish(finish);
        setFunnelStage('upsell');
        return;
      }

      finishCardPurchase(finish);
    } catch {
      setError('Erro inesperado. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  // ───────────────────────── Estados de carregamento / erro de link ─────────────────────────

  if (fetching) {
    return (
      <Screen variant="processing">
        <DesktopHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-[22px] text-center">
          <Spinner size={64} width={6} />
          <div className="text-sm text-[#a9a3b8]">Carregando seu pedido…</div>
        </div>
      </Screen>
    );
  }

  // ───────────────────────── Funil pós-compra (2a–2c / 6a–6c) ─────────────────────────

  if (
    (funnelStage === 'upsell' || funnelStage === 'downsell') &&
    !preview &&
    link &&
    mainTxId
  ) {
    const offer =
      funnelStage === 'upsell' ? link.ofertas?.upsell : link.ofertas?.downsell;
    if (offer) {
      const offerPrice =
        paymentMethod === 'credit' ? offer.valorCartao : offer.valor;
      return (
        <FunnelOfferScreen
          key={offer.id}
          stage={funnelStage}
          offer={offer}
          linkId={link.id}
          method={paymentMethod}
          customer={{ name, email, document, phone }}
          parentPaymentId={mainTxId}
          buildCardBody={buildCardBody}
          onAccepted={() => {
            setAcceptedOffers((prev) =>
              prev.some((o) => o.id === offer.id)
                ? prev
                : [
                    ...prev,
                    { id: offer.id, titulo: offer.titulo, valor: offerPrice },
                  ],
            );
            advanceFunnel(true);
          }}
          onDeclined={() => advanceFunnel(false)}
        />
      );
    }
  }

  // ───────────────────────── Valores derivados ─────────────────────────

  const base = link ? (link.valorComOfertas ?? link.valor) : 0;
  const pixTotal = link ? (link.valorPix ?? base) : 0;

  // ───────────────────────── Sucesso PIX (3c / 7b) ─────────────────────────

  if (
    !preview &&
    paymentConfirmed &&
    funnelStage !== 'upsell' &&
    funnelStage !== 'downsell'
  ) {
    const bumpsPaid =
      link?.ofertas?.orderBumps.filter((o) => selectedBumps.includes(o.id)) ??
      [];
    const totalPaid =
      pixTotal + acceptedOffers.reduce((a, o) => a + o.valor, 0);
    const rows = (
      <>
        {link && (
          <SummaryRow
            label={sanitizeCheckoutText(link.titulo)}
            value={formatCurrency(link.valor)}
          />
        )}
        {bumpsPaid.map((o) => (
          <SummaryRow
            key={o.id}
            accent
            label={`+ ${sanitizeCheckoutText(o.titulo)}`}
            value={formatCurrency(o.valor)}
          />
        ))}
        {acceptedOffers.map((o) => (
          <SummaryRow
            key={o.id}
            accent
            label={`+ ${sanitizeCheckoutText(o.titulo)}`}
            value={formatCurrency(o.valor)}
          />
        ))}
        <SummaryRow muted label="Forma" value="PIX" />
        <SummaryRow
          muted
          label="Data"
          value={formatPaidAt(paidAt ?? new Date())}
          last
        />
      </>
    );
    return (
      <Screen variant="success">
        <DesktopHeader />
        <div className="flex flex-1 flex-col gap-[18px] lg:grid lg:grid-cols-[minmax(0,1fr)_460px] lg:items-center lg:gap-12 lg:px-10">
          <div className="flex flex-col items-center gap-3.5 pt-6 text-center lg:items-start lg:gap-[22px] lg:pt-0 lg:text-left">
            <div className="flex h-[120px] w-[120px] items-center justify-center rounded-full bg-[linear-gradient(135deg,#9a8cf7,#6c5ce0)] shadow-[0_20px_60px_-10px_rgba(124,106,232,.7),inset_0_2px_0_rgba(255,255,255,.35)]">
              <Check
                className="h-[52px] w-[52px] text-white"
                strokeWidth={2.6}
              />
            </div>
            <div>
              <div className="text-[15px] text-[#c8c2d4] lg:text-base">
                Pagamento aprovado
              </div>
              <div className="mt-1 text-2xl font-semibold lg:mt-1.5 lg:text-[38px] lg:leading-[1.15]">
                {formatCurrency(totalPaid)} pagos com sucesso
              </div>
            </div>
            {email && (
              <div className="hidden items-center gap-2.5 text-[15px] text-[#a9a3b8] lg:flex">
                <Mail className="h-[18px] w-[18px]" strokeWidth={2} />
                Acesso enviado para {email}
              </div>
            )}
            {link?.redirectUrl && (
              <a
                href={link.redirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sp2-cta hidden px-10 lg:inline-flex"
              >
                Acessar meu conteúdo
              </a>
            )}
          </div>
          <div
            className={cx(
              'rounded-[26px] px-[18px] py-1.5 lg:rounded-[28px] lg:px-6 lg:py-2',
              GLASS,
            )}
          >
            {rows}
            <div className="hidden justify-between gap-4 border-t border-dashed border-white/[0.12] py-[13px] text-[15px] lg:flex">
              <span className="text-[#a9a3b8]">Total</span>
              <span className="text-[22px] font-semibold tabular-nums">
                {formatCurrency(totalPaid)}
              </span>
            </div>
          </div>
          {email && (
            <div className="flex items-center justify-center gap-2.5 px-2.5 text-center text-[13px] text-[#a9a3b8] lg:hidden">
              <Mail className="h-4 w-4 shrink-0" strokeWidth={2} />
              Acesso enviado para {email}
            </div>
          )}
          <div className="flex-1 lg:hidden" />
          {link?.redirectUrl && (
            <a
              href={link.redirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="sp2-cta w-full lg:hidden"
            >
              Acessar meu conteúdo
            </a>
          )}
        </div>
      </Screen>
    );
  }

  if (linkError || !link) {
    return (
      <Screen variant="error">
        <DesktopHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 text-center">
          <div className="flex h-[100px] w-[100px] items-center justify-center rounded-full border border-[rgba(255,160,160,.35)] bg-[rgba(255,140,140,.14)]">
            <AlertCircle
              className="h-10 w-10 text-[#ff9d9d]"
              strokeWidth={2.2}
            />
          </div>
          <div className="text-2xl font-medium">Link não encontrado</div>
          <div className="max-w-sm text-sm leading-normal text-[#a9a3b8]">
            {linkError || 'Verifique o endereço do link de pagamento.'}
          </div>
        </div>
      </Screen>
    );
  }

  // ───────────────────────── Checkout ─────────────────────────

  const productTitle = sanitizeCheckoutText(link.titulo);
  const productDesc = link.descricao
    ? sanitizeCheckoutText(link.descricao)
    : '';
  const orderBumps = link.ofertas?.orderBumps ?? [];
  const chosenBumps = orderBumps.filter((o) => selectedBumps.includes(o.id));
  const itemsCount = 1 + chosenBumps.length;
  const itemsLabel = `${itemsCount} ${itemsCount > 1 ? 'itens' : 'item'}`;
  const pixGenerated = Boolean(pixContent || pixQrCode);

  const currentOpt = link.opcoesParcelas?.[installments - 1];
  const debitTotal = link.valorDebito ?? base;
  const creditTotal = currentOpt?.valorTotal ?? base;
  const methodTotal =
    paymentMethod === 'pix'
      ? pixTotal
      : paymentMethod === 'debit'
        ? debitTotal
        : creditTotal;
  const methodName =
    paymentMethod === 'pix'
      ? 'PIX'
      : paymentMethod === 'debit'
        ? 'débito'
        : 'crédito';
  const methodLabel =
    paymentMethod === 'pix'
      ? 'PIX'
      : paymentMethod === 'debit'
        ? 'Débito'
        : `Crédito ${installments}x`;
  const cardKind = paymentMethod === 'debit' ? 'Débito' : 'Crédito';

  const methods: { id: PaymentMethod; name: string; long: string }[] = [];
  if (link.aceitaPix)
    methods.push({
      id: 'pix',
      name: 'PIX',
      long: `Aprovação na hora · ${formatCurrency(pixTotal)}`,
    });
  if (link.aceitaCartao) {
    const oneX = link.opcoesParcelas?.[0]?.valorTotal ?? base;
    methods.push({
      id: 'credit',
      name: 'Crédito',
      long:
        link.parcelasMax > 1
          ? `Até ${link.parcelasMax}x · ${formatCurrency(oneX)} à vista`
          : `À vista · ${formatCurrency(oneX)}`,
    });
  }
  if (link.aceitaDebito)
    methods.push({
      id: 'debit',
      name: 'Débito',
      long: `À vista · ${formatCurrency(debitTotal)}`,
    });

  // Validação — dados
  const docDigits = document.replace(/\D/g, '');
  const nameOk = name.trim().length >= 3;
  const emailOk = EMAIL_RE.test(email.trim());
  const docOk = docDigits.length === 11 || docDigits.length === 14;
  const phoneOk = phone.replace(/\D/g, '').length >= 11;
  const dadosOk = nameOk && emailOk && docOk && phoneOk;

  // Validação — cartão
  const hd = holderDocument.replace(/\D/g, '');
  const cardNumOk = cardNumber.replace(/\s/g, '').length >= 13;
  const expOk = cardMonth.length === 2 && cardYear.length === 2;
  const cvvOk = cardCvv.length >= 3;
  const holderOk = holderName.trim().length >= 2;
  const holderDocOk = hd.length === 11 || hd.length === 14;
  const cardFieldsOk = cardNumOk && expOk && cvvOk && holderOk && holderDocOk;

  const dErr = (ok: boolean, msg: string) =>
    showDadosErrors && !ok ? msg : undefined;
  const cErr = (ok: boolean, msg: string) =>
    showCardErrors && !ok ? msg : undefined;

  function goToPayment(method: PaymentMethod) {
    setError('');
    setStep(method === 'pix' ? 'pix' : 'cartao');
  }

  function onPrimary(e?: { preventDefault(): void }) {
    e?.preventDefault();
    if (
      loading ||
      quoting ||
      (preview && (step === 'cartao' || step === 'pix'))
    )
      return;
    setError('');
    // Desktop: sem etapa "Dados", então valida aqui antes de seguir para o pagamento.
    if (desktop && !pixGenerated) {
      setShowDadosErrors(true);
      if (!preview && !dadosOk) return;
      if (!methods.length) return;
    }
    switch (step) {
      case 'pedido':
        setStep('dados');
        return;
      case 'dados':
        setShowDadosErrors(true);
        if (preview || dadosOk) setStep('forma');
        return;
      case 'forma':
        if (!methods.length) return;
        goToPayment(paymentMethod);
        return;
      case 'cartao':
        setShowCardErrors(true);
        if (cardFieldsOk) void handleSubmit();
        return;
      case 'pix':
        if (!pixGenerated) void handleSubmit();
        return;
    }
  }

  function goBack() {
    setError('');
    if (step === 'dados') setStep('pedido');
    else if (step === 'forma') setStep('dados');
    else if (step === 'cartao' || step === 'pix') setStep('forma');
  }

  function onExpiryChange(v: string) {
    const d = onlyDigits(v, 4);
    const m = maskCardMonth(d.slice(0, 2));
    setCardMonth(m);
    // maskCardMonth("2") → "02": o próximo dígito já vai para o ano
    setCardYear(m.length === 2 ? maskCardYear(d.slice(2)) : '');
  }

  const installmentOptions = Array.from(
    { length: link.parcelasMax },
    (_, i) => i + 1,
  );
  const installmentLabelFor = (n: number) => {
    const opt = link.opcoesParcelas?.[n - 1];
    // "(com juros)" é decidido comparando o total da
    // opção contra link.valor (original) — não a flag
    // temJuros, que ignora a taxa DOM.
    return opt
      ? buildInstallmentLabel({
          installments: n,
          perInstallment: opt.valorParcela,
          total: opt.valorTotal,
          original: link.valorComOfertas ?? link.valor,
          formatCurrency,
        })
      : buildInstallmentLabel({
          installments: n,
          perInstallment: link.valor / n,
          total: link.valor,
          original: link.valor,
          formatCurrency,
        });
  };

  const last4 = cardNumber.replace(/\s/g, '').slice(-4);
  const cardDigits = cardNumber.replace(/\D/g, '');
  const cardNumDisplay = (
    cardDigits.length > 16 ? cardDigits : cardDigits.padEnd(16, '•')
  )
    .match(/.{1,4}/g)!
    .join(' ');
  const cardExpDisplay = cardMonth
    ? cardYear
      ? `${cardMonth}/${cardYear}`
      : cardMonth
    : '';

  // ───────────────────────── Processando cartão (3b / 7a) ─────────────────────────

  if (loading && step === 'cartao') {
    const rows = (
      <>
        <SummaryRow muted label="Valor" value={formatCurrency(methodTotal)} />
        <SummaryRow muted label="Cartão" value={`${cardKind} •••• ${last4}`} />
        <SummaryRow
          muted
          label="Parcelas"
          value={
            paymentMethod === 'credit'
              ? installmentLabelFor(installments)
              : 'À vista'
          }
          last
        />
      </>
    );
    return (
      <Screen variant="processing">
        <DesktopHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-[22px] text-center lg:gap-7">
          <Spinner size={96} width={8} />
          <div>
            <div className="text-2xl font-medium lg:text-[32px]">
              Processando seu cartão…
            </div>
            <div className="mt-2 text-sm leading-normal text-[#a9a3b8] lg:mt-2.5 lg:text-base">
              Leva alguns segundos.
              <br className="lg:hidden" /> Não feche nem atualize esta página.
            </div>
          </div>
          <div
            className={cx(
              'hidden w-[440px] rounded-[28px] px-[22px] py-1.5 text-left lg:block',
              GLASS,
            )}
          >
            {rows}
          </div>
        </div>
        <div className={cx('rounded-[24px] px-[18px] py-1.5 lg:hidden', GLASS)}>
          {rows}
        </div>
      </Screen>
    );
  }

  // ───────────────────────── Resumo lateral (desktop) ─────────────────────────

  const asideRows = (
    <>
      <SummaryRow label={productTitle} value={formatCurrency(link.valor)} />
      {chosenBumps.map((o) => (
        <SummaryRow
          key={o.id}
          accent
          label={`+ ${sanitizeCheckoutText(o.titulo)}`}
          value={formatCurrency(o.valor)}
        />
      ))}
      {!declined && (step === 'forma' || step === 'cartao') && (
        <SummaryRow label="Forma de pagamento" value={methodLabel} />
      )}
      {!declined && step === 'pix' && !pixGenerated && (
        <SummaryRow label="Pagador" value={name || '—'} />
      )}
    </>
  );
  const asideTotal = step === 'pedido' || step === 'dados' ? base : methodTotal;

  // ───────────────────────── Cartão recusado (3d / 7c) ─────────────────────────

  if (declined) {
    const retry = () => {
      setDeclined(false);
      setStep('cartao');
    };
    const otherCard = () => {
      setCardNumber('');
      setCardMonth('');
      setCardYear('');
      setCardCvv('');
      setHolderName('');
      setHolderDocument('');
      setShowCardErrors(false);
      setDeclined(false);
      setStep('cartao');
    };
    const payWithPix = () => {
      setPaymentMethod('pix');
      setDeclined(false);
      setStep('pix');
    };
    return (
      <Screen variant="error">
        <DesktopHeader />
        <div className="flex flex-1 flex-col gap-[18px] lg:grid lg:flex-none lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-7">
          <div className="flex flex-1 flex-col gap-[18px] lg:gap-5">
            <div
              className={cx(
                'flex flex-col gap-[18px] lg:gap-[22px] lg:rounded-[28px] lg:p-8',
                LG_GLASS,
              )}
            >
              <div className="flex flex-col items-center gap-3.5 pt-6 text-center lg:flex-row lg:gap-5 lg:pt-0 lg:text-left">
                <div className="flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-full border border-[rgba(255,160,160,.35)] bg-[rgba(255,140,140,.14)] lg:h-20 lg:w-20">
                  <X
                    className="h-10 w-10 text-[#ff9d9d] lg:h-[34px] lg:w-[34px]"
                    strokeWidth={2.4}
                  />
                </div>
                <div>
                  <div className="text-2xl font-medium lg:text-[28px]">
                    Pagamento não aprovado
                  </div>
                  <div className="mt-2 text-sm leading-normal text-[#a9a3b8] lg:mt-1.5 lg:text-[15px]">
                    O banco recusou a transação. Nada foi cobrado.
                    <span className="lg:hidden">
                      <br />
                      Verifique os dados ou tente outra forma.
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-[18px] lg:grid lg:grid-cols-2 lg:gap-3.5">
                <div className="flex items-center gap-3 rounded-[22px] border border-[rgba(255,160,160,.3)] bg-white/[0.07] px-4 py-3.5 lg:px-[18px] lg:py-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.12] lg:h-11 lg:w-11">
                    <CreditCardIcon
                      className="h-[18px] w-[18px] lg:h-5 lg:w-5"
                      strokeWidth={1.8}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-medium lg:text-base">
                      {cardKind} •••• {last4}
                    </div>
                    <div className="mt-0.5 text-xs text-[#ff9d9d] lg:text-[13px]">
                      Recusado pelo emissor
                    </div>
                  </div>
                </div>
                {link.aceitaPix && (
                  <button
                    type="button"
                    onClick={payWithPix}
                    className="flex items-center gap-3 rounded-[22px] border border-white/[0.13] bg-white/[0.07] px-4 py-3.5 text-left transition hover:bg-white/[0.1] lg:px-[18px] lg:py-4"
                  >
                    <MethodIcon method="pix" size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-medium lg:text-base">
                        Pagar com PIX
                      </div>
                      <div className="mt-0.5 text-xs text-[#a9a3b8] lg:text-[13px]">
                        Aprovação na hora
                        <span className="lg:hidden">
                          {' '}
                          · {formatCurrency(pixTotal)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight
                      className="h-[18px] w-[18px] text-[#a9a3b8]"
                      strokeWidth={2}
                    />
                  </button>
                )}
              </div>
              <div className="hidden items-center gap-3.5 lg:flex">
                <CtaButton
                  type="button"
                  onClick={retry}
                  className="w-auto px-10"
                >
                  Tentar novamente
                </CtaButton>
                <button
                  type="button"
                  onClick={otherCard}
                  className="px-3 text-[15px] text-[#a9a3b8] transition hover:text-[#d9d4e3]"
                >
                  Usar outro cartão
                </button>
              </div>
            </div>
            <div className="flex-1 lg:hidden" />
            <CtaButton type="button" onClick={retry} className="lg:hidden">
              Tentar novamente
            </CtaButton>
            <button
              type="button"
              onClick={otherCard}
              className="pb-1 text-center text-sm text-[#a9a3b8] transition hover:text-[#d9d4e3] lg:hidden"
            >
              Usar outro cartão
            </button>
          </div>
          <SummaryAside
            productTitle={productTitle}
            productImage={link.imagemUrl}
            itemsLabel={itemsLabel}
            rows={asideRows}
            total={formatCurrency(base)}
            action={<StatusPill>Nada foi cobrado</StatusPill>}
          />
        </div>
      </Screen>
    );
  }

  // ───────────────────────── Etapas ─────────────────────────

  const previewPaymentStep = preview && (step === 'cartao' || step === 'pix');
  const ctaLabel = previewPaymentStep
    ? 'Pagamento desabilitado na prévia'
    : step === 'pedido'
      ? 'Continuar'
      : step === 'dados'
        ? 'Continuar para pagamento'
        : step === 'forma'
          ? `Continuar com ${methodName}`
          : step === 'cartao'
            ? `Pagar ${formatCurrency(methodTotal)}`
            : loading
              ? 'Gerando código PIX…'
              : 'Gerar código PIX';

  const cta = (className?: string) =>
    step === 'pix' && pixGenerated ? null : (
      <CtaButton
        type="submit"
        disabled={
          loading ||
          quoting ||
          previewPaymentStep ||
          (step === 'forma' && !methods.length)
        }
        className={className}
      >
        {loading && <Spinner size={18} width={3} />}
        {ctaLabel}
      </CtaButton>
    );

  const asideAction =
    step === 'pix' && pixGenerated ? (
      <StatusPill>
        <Spinner size={16} width={3} />
        Aguardando pagamento…
      </StatusPill>
    ) : (
      cta()
    );

  const mobileHeader =
    step === 'pedido' ? (
      <div className="flex flex-col gap-4 lg:hidden">
        <div className="flex items-center justify-between">
          <Logo />
          <ProtectedPill compact />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-2xl font-medium">Seu pedido</div>
          <MobileProgress step={1} />
        </div>
      </div>
    ) : (
      <>
        <MobileTopBar
          title={
            step === 'dados'
              ? 'Seus dados'
              : step === 'forma'
                ? 'Pagamento'
                : step === 'cartao'
                  ? `Cartão de ${methodName}`
                  : 'Pagar com PIX'
          }
          onBack={goBack}
        />
        {step === 'dados' && <MobileProgress step={2} />}
        {step === 'forma' && <MobileProgress step={3} />}
      </>
    );

  return (
    <Screen>
      {preview && <PreviewNotice noMethods={!methods.length} />}
      <DesktopHeader />
      {mobileHeader}

      <form
        onSubmit={onPrimary}
        noValidate
        className="flex flex-1 flex-col gap-4 lg:grid lg:flex-none lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-7"
      >
        <div className="flex flex-1 flex-col gap-4 lg:gap-5">
          {/* ── 4a / 5a Pedido ── */}
          {visible('pedido') && (
            <>
              <div
                className={cx(
                  'flex flex-col gap-3.5 rounded-[28px] p-3 lg:p-5',
                  link.imagemUrl
                    ? 'lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-center lg:gap-6'
                    : 'pt-[18px]',
                  GLASS,
                )}
              >
                {link.imagemUrl && (
                  <ProductImage
                    src={link.imagemUrl}
                    className="h-40 w-full rounded-[20px] lg:h-[200px]"
                  />
                )}
                <div className="flex items-start justify-between gap-3 px-1.5 pb-1.5 lg:flex-col lg:justify-start lg:gap-2.5 lg:p-0">
                  <div className="min-w-0">
                    <div className="text-[19px] font-medium lg:text-[28px]">
                      {productTitle}
                    </div>
                    {productDesc && (
                      <div className="mt-1 text-[13px] leading-[1.4] text-[#a9a3b8] lg:mt-2.5 lg:text-[15px] lg:leading-normal lg:text-[#b8b2c6]">
                        {productDesc}
                      </div>
                    )}
                  </div>
                  <div className="whitespace-nowrap text-lg font-semibold tabular-nums lg:mt-1.5 lg:text-[26px]">
                    {formatCurrency(link.valor)}
                  </div>
                </div>
              </div>

              {orderBumps.length > 0 && (
                <div
                  className={cx(
                    'flex flex-col gap-2.5 rounded-[26px] p-3.5 lg:gap-3.5 lg:rounded-[28px] lg:p-6',
                    GLASS,
                  )}
                >
                  <div className="px-1 pb-1 pt-0.5 lg:p-0">
                    <div className="text-base lg:text-2xl lg:font-medium">
                      Aproveite também
                    </div>
                    <div className="mt-0.5 text-xs text-[#a9a3b8] lg:mt-1 lg:text-sm">
                      Condições disponíveis só nesta compra
                    </div>
                  </div>
                  {orderBumps.map((offer) => (
                    <OrderBumpCard
                      key={offer.id}
                      offer={offer}
                      checked={selectedBumps.includes(offer.id)}
                      // Com o PIX já gerado o valor está fechado.
                      disabled={pixGenerated || loading}
                      onToggle={() => void toggleOrderBump(offer.id)}
                    />
                  ))}
                </div>
              )}

              <div className="flex items-baseline justify-between px-2 lg:hidden">
                <span className="text-[15px] text-[#a9a3b8]">
                  Total · {itemsLabel}
                </span>
                <span
                  className={cx(
                    'text-[26px] font-semibold tabular-nums transition-opacity',
                    quoting && 'opacity-50',
                  )}
                >
                  {formatCurrency(base)}
                </span>
              </div>
            </>
          )}

          {/* ── 4b / 5b Dados ── */}
          {visible('dados') && (
            <>
              <div
                className={cx(
                  'flex flex-col gap-3.5 rounded-[28px] p-[18px] lg:gap-[22px] lg:p-7',
                  GLASS,
                )}
              >
                <div className="hidden lg:block">
                  <div className="text-2xl font-medium">Seus dados</div>
                  <div className="mt-1 text-sm text-[#a9a3b8]">
                    Usados para emitir o pagamento e enviar seu acesso
                  </div>
                </div>
                <div className="flex flex-col gap-3.5 lg:grid lg:grid-cols-2 lg:gap-x-[18px] lg:gap-y-4">
                  <Field
                    label="Nome completo"
                    error={dErr(nameOk, 'Informe seu nome completo')}
                  >
                    <input
                      className="sp2-input"
                      name="name"
                      placeholder="Como está no documento"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      aria-invalid={Boolean(dErr(nameOk, 'x'))}
                    />
                  </Field>
                  <Field
                    label="E-mail"
                    hint="O acesso ao produto chega neste e-mail"
                    error={dErr(emailOk, 'Informe um e-mail válido')}
                  >
                    <input
                      className="sp2-input"
                      type="email"
                      name="email"
                      inputMode="email"
                      placeholder="voce@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      aria-invalid={Boolean(dErr(emailOk, 'x'))}
                    />
                  </Field>
                  <Field
                    label="CPF / CNPJ"
                    error={dErr(docOk, 'CPF ou CNPJ incompleto')}
                  >
                    <input
                      className="sp2-input"
                      name="customer-document"
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      value={document}
                      onChange={(e) => setDocument(maskCpfCnpj(e.target.value))}
                      autoComplete="off"
                      aria-invalid={Boolean(dErr(docOk, 'x'))}
                    />
                  </Field>
                  <Field
                    label="Celular"
                    error={dErr(phoneOk, 'Informe o celular com DDD')}
                  >
                    <div
                      className="sp2-input sp2-input-wrap"
                      aria-invalid={Boolean(dErr(phoneOk, 'x'))}
                    >
                      <span className="flex h-full items-center border-r border-white/10 px-3.5 text-[15px] text-[#a9a3b8]">
                        +55
                      </span>
                      <input
                        name="phone"
                        inputMode="tel"
                        placeholder="(00) 00000-0000"
                        value={phone}
                        onChange={(e) => setPhone(maskPhoneBr(e.target.value))}
                        autoComplete="tel-national"
                      />
                    </div>
                  </Field>
                </div>
                <BuyerMemoryPreference
                  {...buyerMemory}
                  className="mt-1 space-y-2 text-[13px] text-[#a9a3b8]"
                />
                <div className="hidden items-center gap-2.5 text-[13px] text-[#7d778b] lg:flex">
                  <Lock className="h-3.5 w-3.5" strokeWidth={2} />
                  Dados protegidos durante sua compra
                </div>
              </div>
              <div className="flex items-center justify-center gap-2.5 text-xs text-[#7d778b] lg:hidden">
                <Lock className="h-3.5 w-3.5" strokeWidth={2} />
                Dados protegidos durante sua compra
              </div>
            </>
          )}

          {/* ── 4c / 5c Forma de pagamento ── */}
          {visible('forma') && (
            <>
              {/* mobile */}
              <div
                className={cx(
                  'flex flex-col gap-2.5 rounded-[28px] p-3.5 lg:hidden',
                  GLASS,
                )}
              >
                <div className="p-1 text-base text-[#d9d4e3]">
                  Escolha como pagar
                </div>
                {methods.map((m) => {
                  const on = m.id === paymentMethod;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPaymentMethod(m.id)}
                      className={cx(
                        'flex items-center gap-3 rounded-[20px] border px-3 py-3.5 text-left transition-colors',
                        on
                          ? 'border-[rgba(240,168,108,.7)] bg-white/[0.12]'
                          : 'border-white/[0.07] bg-white/[0.06]',
                      )}
                    >
                      <MethodIcon method={m.id} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-medium">{m.name}</div>
                        <div className="mt-0.5 text-xs text-[#a9a3b8]">
                          {m.long}
                        </div>
                      </div>
                      <span className="sp2-radio h-5 w-5" data-on={on} />
                    </button>
                  );
                })}
              </div>
              <div
                className={cx(
                  'rounded-[22px] px-[18px] py-1.5 lg:hidden',
                  GLASS,
                )}
              >
                <SummaryRow muted size="sm" label="Pedido" value={itemsLabel} />
                <div className="flex items-baseline justify-between py-[13px] text-sm">
                  <span className="text-[#a9a3b8]">Total</span>
                  <span className="text-xl font-semibold tabular-nums">
                    {formatCurrency(methodTotal)}
                  </span>
                </div>
              </div>

              {/* desktop */}
              <div
                className={cx(
                  'hidden flex-col gap-[22px] rounded-[28px] p-7 lg:flex',
                  GLASS,
                )}
              >
                <div className="text-2xl font-medium">Escolha como pagar</div>
                <div
                  className="grid gap-3.5"
                  style={{
                    gridTemplateColumns: `repeat(${Math.max(methods.length, 1)}, minmax(0, 1fr))`,
                  }}
                >
                  {methods.map((m) => {
                    const on = m.id === paymentMethod;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPaymentMethod(m.id)}
                        className={cx(
                          'flex flex-col gap-[18px] rounded-[24px] border p-5 text-left transition-colors',
                          on
                            ? 'border-[rgba(240,168,108,.7)] bg-white/[0.12]'
                            : 'border-white/[0.07] bg-white/[0.06] hover:bg-white/[0.08]',
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <MethodIcon method={m.id} size="lg" />
                          <span
                            className="sp2-radio h-[22px] w-[22px]"
                            data-on={on}
                          />
                        </div>
                        <div>
                          <div className="text-[19px] font-medium">
                            {m.name}
                          </div>
                          <div className="mt-1 text-sm text-[#a9a3b8]">
                            {m.long}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div
                className={cx(
                  'hidden items-center gap-3.5 rounded-[28px] px-[22px] py-4 lg:flex',
                  GLASS,
                )}
              >
                <CheckDot size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{name}</div>
                  <div className="truncate text-[13px] text-[#a9a3b8]">
                    {email}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('dados')}
                  className="text-sm text-[#f6b67a] transition hover:text-[#ffd2a8]"
                >
                  Editar dados
                </button>
              </div>
            </>
          )}

          {/* ── 4d / 5d Cartão ── */}
          {step === 'cartao' && (
            <div
              className={cx(
                'flex flex-col gap-4 lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-7 lg:rounded-[28px] lg:p-7',
                LG_GLASS,
              )}
            >
              <div className="flex flex-col gap-4">
                <div className="hidden text-2xl font-medium lg:block">
                  Cartão de {methodName}
                </div>
                <div
                  className="relative flex h-[204px] flex-col justify-between overflow-hidden rounded-[26px] border border-white/[0.18] p-[22px] backdrop-blur-[24px] lg:h-[220px] lg:p-6"
                  style={{
                    background:
                      'radial-gradient(70% 90% at 75% 85%, rgba(245,150,70,.6), transparent 70%),radial-gradient(60% 70% at 10% 10%, rgba(141,128,244,.5), transparent 70%),rgba(255,255,255,.08)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[17px] font-semibold lg:text-lg">
                      {cardKind}
                    </span>
                    <span className="text-[11px] tracking-[.08em] text-[#d9d4e3]">
                      {cardBrandLabel(cardNumber)}
                    </span>
                  </div>
                  <div className="h-8 w-[42px] rounded-[7px] bg-[linear-gradient(135deg,#f4d58a,#c99a3c)] lg:h-[34px] lg:w-11" />
                  <div>
                    <div className="whitespace-nowrap text-[21px] font-semibold tabular-nums tracking-[.06em] lg:text-[22px]">
                      {cardNumDisplay}
                    </div>
                    <div className="mt-1.5 flex justify-between gap-3 text-sm text-[#e6e1ee]">
                      <span className="truncate">
                        {holderName || 'NOME DO TITULAR'}
                      </span>
                      <span className="shrink-0">
                        {cardExpDisplay || 'MM/AA'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="hidden items-center gap-2.5 text-[13px] text-[#a9a3b8] lg:flex">
                  <Lock className="h-3.5 w-3.5" strokeWidth={2} />
                  Os dados do cartão são criptografados
                </div>
              </div>

              <div
                className={cx(
                  'grid grid-cols-2 gap-3 rounded-[28px] p-[18px] lg:gap-x-4 lg:gap-y-3.5 lg:rounded-none lg:p-0 lg:pt-1',
                  SM_GLASS,
                )}
              >
                <Field
                  className="col-span-2"
                  label="Número do cartão"
                  error={cErr(cardNumOk, 'Número do cartão incompleto')}
                >
                  <input
                    className="sp2-input h-[50px] lg:h-[52px]"
                    name="cc-number"
                    inputMode="numeric"
                    placeholder="0000 0000 0000 0000"
                    value={cardNumber}
                    onChange={(e) =>
                      setCardNumber(maskCardNumber(e.target.value))
                    }
                    autoComplete="cc-number"
                    aria-invalid={Boolean(cErr(cardNumOk, 'x'))}
                  />
                </Field>
                <Field
                  className="col-span-2"
                  label="Nome do titular"
                  error={cErr(holderOk, 'Informe o nome impresso no cartão')}
                >
                  <input
                    className="sp2-input h-[50px] lg:h-[52px]"
                    name="cc-name"
                    placeholder="Como impresso no cartão"
                    value={holderName}
                    onChange={(e) => setHolderName(e.target.value)}
                    autoComplete="cc-name"
                    aria-invalid={Boolean(cErr(holderOk, 'x'))}
                  />
                </Field>
                <Field
                  label="Validade"
                  error={cErr(expOk, 'Validade incompleta')}
                >
                  <input
                    className="sp2-input h-[50px] lg:h-[52px]"
                    name="cc-exp"
                    inputMode="numeric"
                    placeholder="MM/AA"
                    value={cardExpDisplay}
                    onChange={(e) => onExpiryChange(e.target.value)}
                    autoComplete="cc-exp"
                    aria-invalid={Boolean(cErr(expOk, 'x'))}
                  />
                </Field>
                <Field label="CVV" error={cErr(cvvOk, 'CVV incompleto')}>
                  <input
                    className="sp2-input h-[50px] lg:h-[52px]"
                    name="cc-csc"
                    inputMode="numeric"
                    placeholder="000"
                    maxLength={4}
                    value={cardCvv}
                    onChange={(e) => setCardCvv(maskCvv(e.target.value))}
                    autoComplete="cc-csc"
                    aria-invalid={Boolean(cErr(cvvOk, 'x'))}
                  />
                </Field>
                <Field
                  className="col-span-2"
                  label="CPF do titular"
                  error={cErr(holderDocOk, 'CPF ou CNPJ do titular incompleto')}
                >
                  <input
                    className="sp2-input h-[50px] lg:h-[52px]"
                    name="cc-holder-document"
                    inputMode="numeric"
                    placeholder="000.000.000-00"
                    value={holderDocument}
                    onChange={(e) =>
                      setHolderDocument(maskCpfCnpj(e.target.value))
                    }
                    autoComplete="off"
                    aria-invalid={Boolean(cErr(holderDocOk, 'x'))}
                  />
                </Field>
                {paymentMethod === 'credit' && link.parcelasMax > 1 && (
                  <Field className="col-span-2" label="Parcelas">
                    <select
                      className="sp2-input h-[50px] lg:h-[52px]"
                      value={installments}
                      onChange={(e) => setInstallments(Number(e.target.value))}
                    >
                      {installmentOptions.map((n) => (
                        <option key={n} value={n}>
                          {installmentLabelFor(n)}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            </div>
          )}

          {/* ── 4e / 5e PIX antes de gerar ── */}
          {step === 'pix' && !pixGenerated && (
            <>
              {/* mobile */}
              <div
                className={cx(
                  'flex flex-col items-center gap-1.5 rounded-[28px] px-5 py-6 text-center lg:hidden',
                  GLASS,
                )}
              >
                <span className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.12] text-[15px] font-bold">
                  PIX
                </span>
                <div className="text-sm text-[#a9a3b8]">Valor à vista</div>
                <div className="text-4xl font-semibold tabular-nums">
                  {formatCurrency(pixTotal)}
                </div>
              </div>
              <div
                className={cx('rounded-[24px] px-4 py-1.5 lg:hidden', GLASS)}
              >
                {PIX_BENEFITS.map(({ Icon, text }, i) => (
                  <div
                    key={text}
                    className={cx(
                      'flex items-center gap-3 py-[13px] text-sm text-[#d9d4e3]',
                      i < PIX_BENEFITS.length - 1 &&
                        'border-b border-dashed border-white/[0.12]',
                    )}
                  >
                    <Icon
                      className="h-[18px] w-[18px] shrink-0 text-[#f6b67a]"
                      strokeWidth={2}
                    />
                    {text}
                  </div>
                ))}
              </div>
              <div
                className={cx(
                  'rounded-[22px] px-[18px] py-1.5 lg:hidden',
                  GLASS,
                )}
              >
                <SummaryRow
                  size="sm"
                  label={productTitle}
                  value={formatCurrency(link.valor)}
                />
                {chosenBumps.map((o) => (
                  <SummaryRow
                    key={o.id}
                    size="sm"
                    accent
                    label={`+ ${sanitizeCheckoutText(o.titulo)}`}
                    value={formatCurrency(o.valor)}
                  />
                ))}
                <SummaryRow
                  size="sm"
                  muted
                  label="Pagador"
                  value={name || '—'}
                  last
                />
              </div>

              {/* desktop */}
              <div
                className={cx(
                  'hidden flex-col gap-7 rounded-[28px] p-8 lg:flex',
                  GLASS,
                )}
              >
                <div className="flex items-center gap-5">
                  <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-white/[0.12] text-base font-bold">
                    PIX
                  </span>
                  <div>
                    <div className="text-[15px] text-[#a9a3b8]">
                      Valor à vista
                    </div>
                    <div className="text-[40px] font-semibold leading-[1.1] tabular-nums">
                      {formatCurrency(pixTotal)}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3.5">
                  {PIX_BENEFITS.map(({ Icon, text }) => (
                    <div
                      key={text}
                      className="flex flex-col gap-3 rounded-[22px] bg-white/[0.07] p-[18px]"
                    >
                      <Icon
                        className="h-[22px] w-[22px] text-[#f6b67a]"
                        strokeWidth={2}
                      />
                      <div className="text-[15px] text-[#d9d4e3]">{text}</div>
                    </div>
                  ))}
                </div>
                <div className="text-sm text-[#a9a3b8]">
                  Ao clicar em gerar, mostramos o QR Code e o código copia e
                  cola.
                </div>
              </div>
            </>
          )}

          {/* ── 3a / 5f PIX gerado ── */}
          {step === 'pix' && pixGenerated && (
            <PixDisplay
              pixContent={pixContent}
              qrCode={pixQrCode}
              pixExpire={pixExpire}
              amount={pixTotal}
            />
          )}

          {/* CTA mobile (fim da tela) */}
          <div className="flex-1 lg:hidden" />
          {error && <ErrorBox className="lg:hidden">{error}</ErrorBox>}
          {cta('lg:hidden')}
        </div>

        <SummaryAside
          productTitle={productTitle}
          productImage={link.imagemUrl}
          itemsLabel={itemsLabel}
          rows={asideRows}
          total={formatCurrency(asideTotal)}
          dimTotal={quoting}
          action={
            <>
              {error && <ErrorBox>{error}</ErrorBox>}
              {asideAction}
            </>
          }
        />
      </form>
    </Screen>
  );
}
