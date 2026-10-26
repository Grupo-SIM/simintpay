'use client';
import { SIM_API_URL, PAGATG_API_URL } from '@/lib/api-config';

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle,
  Calendar,
  CreditCard,
  ArrowRight,
  Home,
  Package,
  Clock,
  Mail,
  Copy,
  Star,
  RefreshCw,
  Send,
  AlertTriangle,
} from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import { usePixPlanSuffix } from '@/hooks/usePixPlanSuffix';

const PAGATG_API = PAGATG_API_URL;
// Backoff: o webhook do PagaTG precisa de um instante para gravar o registro.
// Começa curto (pega o caso rápido em ~1s) e cresce até 5s.
const POLL_DELAYS_MS = [
  1000, 1000, 2000, 3000, 3000, 5000, 5000, 5000, 5000, 5000,
];
const MAX_POLL_ATTEMPTS = POLL_DELAYS_MS.length;
const pollDelayFor = (attempt: number) =>
  POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)];

type TelegramState =
  'polling' | 'ready' | 'already_delivered' | 'timeout' | 'error';

const SuccessPage = () => {
  const { removePixSuffix } = usePixPlanSuffix();
  const router = useRouter();
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');

  const [subscriptionData, setSubscriptionData] = useState<any>(null);
  const [localData, setLocalData] = useState<{
    planName: string | null;
    planValue: number | null;
    paymentMethod: string;
    customerEmail: string | null;
    purchaseDate: string | null;
  }>({
    planName: null,
    planValue: null,
    paymentMethod: 'Cartão de Crédito',
    customerEmail: null,
    purchaseDate: null,
  });
  const [copied, setCopied] = useState(false);

  const [telegramState, setTelegramState] = useState<TelegramState>('polling');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const planCode = localStorage.getItem('checkout_plan_code');
    const email = localStorage.getItem('checkout_email');

    if (!planCode || !email) {
      setTelegramState('ready');
      return;
    }

    let attempt = 0;

    const poll = async () => {
      try {
        const params = new URLSearchParams({ planCode, email });
        if (reference) params.append('subscriptionId', reference);
        const res = await fetch(
          `${PAGATG_API}/group-pages/public/invite-link-by-code?${params}`,
        );
        const data = await res.json();

        if (res.ok) {
          localStorage.removeItem('checkout_plan_code');
          localStorage.removeItem('checkout_email');
          setInviteLink(data.inviteLink);
          setTelegramState('ready');
          return;
        }

        if (res.status === 400) {
          localStorage.removeItem('checkout_plan_code');
          localStorage.removeItem('checkout_email');
          setTelegramState('already_delivered');
          return;
        }

        if (res.status === 404) {
          const delay = pollDelayFor(attempt);
          attempt += 1;
          setPollAttempt(attempt);
          if (attempt < MAX_POLL_ATTEMPTS) {
            pollTimerRef.current = setTimeout(poll, delay);
          } else {
            setTelegramState('timeout');
          }
          return;
        }

        setTelegramState('error');
      } catch {
        const delay = pollDelayFor(attempt);
        attempt += 1;
        setPollAttempt(attempt);
        if (attempt < MAX_POLL_ATTEMPTS) {
          pollTimerRef.current = setTimeout(poll, delay);
        } else {
          setTelegramState('error');
        }
      }
    };

    poll();

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const storedPlanName = localStorage.getItem('checkout_plan_name');
    const storedPlanValue = localStorage.getItem('checkout_plan_value');
    const storedMethod = localStorage.getItem('checkout_payment_method');
    const storedEmail = localStorage.getItem('checkout_email');
    const storedPurchaseDate = localStorage.getItem('checkout_purchase_date');
    setLocalData({
      planName: storedPlanName || null,
      planValue: storedPlanValue ? Number(storedPlanValue) : null,
      paymentMethod: storedMethod || 'Cartão de Crédito',
      customerEmail: storedEmail || null,
      purchaseDate: storedPurchaseDate || new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    if (!reference) return;
    fetch(`${SIM_API_URL}/checkout/public/purchase/${reference}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setSubscriptionData(data);
      })
      .catch(() => {});
  }, [reference]);

  const copyReferenceToClipboard = () => {
    if (!reference) return;
    navigator.clipboard
      .writeText(reference)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => console.error('Falha ao copiar: ', err));
  };

  const formatCurrency = (value: any) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value / 100);
  };

  const formatDate = (dateString: any) => {
    if (!dateString) return '—';
    const options: Intl.DateTimeFormatOptions = {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    };
    return new Date(dateString).toLocaleDateString('pt-BR', options);
  };

  const planName =
    (subscriptionData?.type === 'PIX_PLAN'
      ? subscriptionData?.plan?.name
      : subscriptionData?.subscription?.plan?.description) ??
    localData.planName;

  const planValue =
    (subscriptionData?.type === 'PIX_PLAN'
      ? subscriptionData?.plan?.price
      : subscriptionData?.subscription?.plan?.value) ?? localData.planValue;

  const planFrequency =
    subscriptionData?.type === 'SUBSCRIPTION'
      ? subscriptionData?.subscription?.plan?.frequencyType
      : null;

  const planDays =
    subscriptionData?.type === 'PIX_PLAN'
      ? subscriptionData?.plan?.daysCredited
      : null;

  const isActive =
    subscriptionData?.type === 'PIX_PLAN'
      ? subscriptionData?.planAccess?.isActive
      : true;

  const paymentMethod = subscriptionData
    ? subscriptionData.type === 'PIX_PLAN'
      ? 'PIX'
      : 'Cartão de Crédito'
    : localData.paymentMethod;

  const purchaseDate =
    (subscriptionData?.type === 'PIX_PLAN'
      ? subscriptionData?.transaction?.createdAt
      : subscriptionData?.subscription?.createdAt) ?? localData.purchaseDate;

  const customerEmail =
    (subscriptionData?.type === 'PIX_PLAN'
      ? subscriptionData?.customer?.email
      : subscriptionData?.subscription?.customer?.email) ??
    localData.customerEmail;

  if (telegramState === 'polling') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="animate-pulse text-center">
          <div className="h-24 w-24 bg-gray-200 rounded-full mx-auto mb-4" />
          <div className="h-8 w-48 bg-gray-200 rounded mx-auto mb-4" />
          <div className="h-4 w-64 bg-gray-200 rounded mx-auto" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-4">
        <div className="bg-white rounded-2xl shadow-md overflow-hidden">
          <div className="bg-gradient-to-r from-teal-600 to-blue-600 px-6 py-5 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Package className="w-6 h-6 flex-shrink-0" />
              <div>
                <h2 className="text-lg font-bold leading-tight">
                  Detalhes da Assinatura
                </h2>
                <p className="text-sm text-teal-100">
                  Referência: #{reference}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-green-500 text-white text-sm font-medium px-3 py-1 rounded-full flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                Ativa
              </span>
              <button
                onClick={copyReferenceToClipboard}
                className="bg-white/20 hover:bg-white/30 text-white text-sm px-3 py-1 rounded-lg flex items-center gap-1 transition"
              >
                {copied ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copiar
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div>
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400" />
                Informações do Plano
              </h3>
              <div className="space-y-0">
                <div className="flex justify-between items-center py-3 border-b border-gray-100">
                  <span className="text-gray-500 text-sm">Nome do Plano</span>
                  <span className="font-semibold text-gray-900 text-sm">
                    {planName ? removePixSuffix(planName) : '—'}
                  </span>
                </div>
                <div className="flex justify-between items-start py-3 border-b border-gray-100">
                  <span className="text-gray-500 text-sm">Valor</span>
                  <div className="text-right">
                    <div className="text-xl font-bold text-emerald-600">
                      {planValue != null ? formatCurrency(planValue) : '—'}
                    </div>
                    {planFrequency && (
                      <div className="text-xs text-gray-400">
                        por {planFrequency}
                      </div>
                    )}
                    {planDays && (
                      <div className="text-xs text-gray-400">
                        {planDays} dias
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center py-3">
                  <span className="text-gray-500 text-sm">Status</span>
                  <span
                    className={`text-sm font-medium px-3 py-0.5 rounded-full ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                  >
                    {isActive ? 'Ativa' : 'Inativa'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-blue-500" />
                Informações de Pagamento
              </h3>
              <div className="space-y-0">
                <div className="flex justify-between items-center py-3 border-b border-gray-100">
                  <span className="text-gray-500 text-sm">
                    Método de Pagamento
                  </span>
                  <div className="flex items-center gap-1 font-semibold text-gray-900 text-sm">
                    <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                    {paymentMethod}
                  </div>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-gray-100">
                  <span className="text-gray-500 text-sm">Data da Compra</span>
                  <span className="font-medium text-gray-900 text-sm">
                    {formatDate(purchaseDate)}
                  </span>
                </div>
                <div className="flex justify-between items-center py-3 border-b border-gray-100">
                  <span className="text-gray-500 text-sm">
                    E-mail do Cliente
                  </span>
                  <div className="flex items-center gap-1 font-medium text-gray-900 text-sm">
                    <Mail className="w-3.5 h-3.5 text-gray-400" />
                    {customerEmail ?? '—'}
                  </div>
                </div>
                <div className="flex justify-between items-start py-3 gap-4">
                  <span className="text-gray-500 text-sm whitespace-nowrap">
                    ID da Transação
                  </span>
                  <span className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded break-all text-right">
                    {reference}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-teal-50 to-green-50 border border-teal-100 rounded-2xl p-8 text-center shadow-sm">
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            🚀 Próximos Passos
          </h3>
          <p className="text-gray-500 text-sm mb-6">
            Sua assinatura está ativa! Clique no botão abaixo para acessar o seu
            conteúdo.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => router.push('/')}
              className="flex items-center justify-center gap-2 bg-white hover:bg-gray-50 text-gray-700 font-medium py-3 px-6 rounded-xl border border-gray-200 transition text-sm"
            >
              <Home className="w-4 h-4" />
              Voltar ao Início
            </button>

            {telegramState === 'ready' && inviteLink && (
              <a
                href={inviteLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-6 rounded-xl transition text-sm"
              >
                Acessar Agora
                <ArrowRight className="w-4 h-4" />
              </a>
            )}

            {telegramState === 'ready' && !inviteLink && (
              <a
                href="mailto:contatosimintermediacoes@gmail.com"
                className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-6 rounded-xl transition text-sm"
              >
                <Send className="w-4 h-4" />
                Contatar Suporte
              </a>
            )}

            {telegramState === 'already_delivered' && (
              <div className="flex flex-col items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center gap-2 text-amber-600 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Link já entregue. Verifique o Telegram ou contate o suporte.
                </div>
                <a
                  href="mailto:contatosimintermediacoes@gmail.com"
                  className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-medium py-3 px-6 rounded-xl transition text-sm w-full"
                >
                  <Mail className="w-4 h-4" />
                  Contatar Suporte
                </a>
              </div>
            )}

            {(telegramState === 'timeout' || telegramState === 'error') && (
              <div className="flex flex-col items-center gap-2 w-full sm:w-auto">
                <div className="flex items-center gap-2 text-amber-600 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                  Pagamento ainda sendo processado. Tente novamente em breve.
                </div>
                <a
                  href="mailto:contatosimintermediacoes@gmail.com"
                  className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-medium py-3 px-6 rounded-xl transition text-sm w-full"
                >
                  <Mail className="w-4 h-4" />
                  Contatar Suporte
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuccessPage;
