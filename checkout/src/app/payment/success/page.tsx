'use client';
import { SIM_API_URL, EBOOK_API_URL } from '@/lib/api-config';

import React, {
  useEffect,
  useState,
  Suspense,
  useCallback,
  useRef,
} from 'react';
import {
  CheckCircle,
  CreditCard,
  ArrowRight,
  Package,
  Clock,
  Mail,
  Copy,
  Shield,
  Star,
  XCircle,
  AlertCircle,
  RefreshCw,
  Ban,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import { useSearchParams, useRouter } from 'next/navigation';
import { usePixPlanSuffix } from '@/hooks/usePixPlanSuffix';
import { sanitizeCheckoutText } from '@/lib/text-utils';

const FINAL_STATUSES = [
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
  'CHARGEBACK',
  'IN_MEDIATION',
  'PENDING_REFUND',
];
const BACK_EBOOK_API_BASE_URL = EBOOK_API_URL;
const SIMPAY_API_BASE = SIM_API_URL;

async function fetchApiMachineStatus(
  reference: string,
): Promise<string | null> {
  try {
    const r = await fetch(
      `${SIMPAY_API_BASE}/checkout/payments/${reference}/status`,
    );
    if (!r.ok) return null;
    const d = await r.json();
    return String(d?.status || '').toUpperCase() || null;
  } catch {
    return null;
  }
}

const PaymentSuccessContent = () => {
  const { removePixSuffix } = usePixPlanSuffix();
  const router = useRouter();
  const searchParams = useSearchParams();
  const reference = searchParams.get('reference');
  const store = String(searchParams.get('store') || '').toLowerCase();
  const orderId = searchParams.get('orderId');

  const [paymentData, setPaymentData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [sseRetry, setSseRetry] = useState(0);
  const sseRef = useRef<EventSource | null>(null);
  const isEbookCheckout = store === 'ebook' || store === 'ebooksim';

  const fetchPaymentStatus = useCallback(async () => {
    if (!reference) {
      setError('Referência do pagamento não encontrada');
      setLoading(false);
      return null;
    }

    // api-machine is authoritative for all stores — check it first
    const machineStatus = await fetchApiMachineStatus(reference);
    if (machineStatus && FINAL_STATUSES.includes(machineStatus)) {
      if (isEbookCheckout && orderId) {
        // Fetch back-ebook order just for the book description
        try {
          const r = await fetch(
            `${BACK_EBOOK_API_BASE_URL}/checkout/orders/${orderId}`,
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer checkout-token-2025-simint',
              },
            },
          );
          if (r.ok) {
            const order = await r.json();
            return {
              id: order?.id || reference,
              paymentId: reference,
              description:
                order?.items?.[0]?.bookTitle ||
                order?.notes ||
                'Pagamento ebook',
              status: machineStatus,
            };
          }
        } catch {
          /* ignore — fall through to generic */
        }
      }
      return {
        id: reference,
        paymentId: reference,
        description: 'Pagamento',
        status: machineStatus,
      };
    }

    // api-machine hasn't confirmed yet — get order info for display
    if (isEbookCheckout && orderId) {
      try {
        const r = await fetch(
          `${BACK_EBOOK_API_BASE_URL}/checkout/orders/${orderId}`,
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer checkout-token-2025-simint',
            },
          },
        );
        if (r.ok) {
          const order = await r.json();
          const normalized = String(
            order?.status || order?.paymentStatus || '',
          ).toLowerCase();
          const backStatus =
            normalized === 'paid' || normalized === 'completed'
              ? 'COMPLETED'
              : 'PENDING';
          return {
            id: order?.id || reference,
            paymentId: reference,
            description:
              order?.items?.[0]?.bookTitle || order?.notes || 'Pagamento ebook',
            // trust COMPLETED from either source
            status:
              backStatus === 'COMPLETED'
                ? 'COMPLETED'
                : machineStatus || 'PENDING',
          };
        }
      } catch {
        /* ignore */
      }
      return {
        id: reference,
        paymentId: reference,
        description: 'Pagamento ebook',
        status: machineStatus || 'PENDING',
      };
    }

    // Non-ebook: use api-machine status endpoint
    try {
      const r = await fetch(
        `${SIMPAY_API_BASE}/checkout/payments/${reference}/status`,
      );
      if (!r.ok) throw new Error('status_not_found');
      return await r.json();
    } catch {
      return { id: reference, paymentId: reference, status: 'PENDING' };
    }
  }, [reference, isEbookCheckout, orderId]);

  // Initial fetch
  useEffect(() => {
    const init = async () => {
      try {
        const data = await fetchPaymentStatus();
        if (data) {
          setPaymentData(data);
          setLoading(false);
          const currentStatus = String(data?.status || '').toUpperCase();
          if (!FINAL_STATUSES.includes(currentStatus)) {
            setIsWaiting(true);
          }
        }
      } catch {
        setError('Não foi possível carregar os detalhes do pagamento');
        setLoading(false);
      }
    };
    init();
    return () => {
      sseRef.current?.close();
    };
  }, [fetchPaymentStatus]);

  // SSE subscription while waiting for payment confirmation
  useEffect(() => {
    if (!isWaiting || !reference) return;

    const es = new EventSource(
      `${SIMPAY_API_BASE}/checkout/pix/${reference}/sse`,
    );
    sseRef.current = es;

    es.addEventListener('payment-status', (event) => {
      try {
        const data = JSON.parse(event.data);
        const status = String(data?.status || '').toUpperCase();
        if (FINAL_STATUSES.includes(status)) {
          setPaymentData((prev: any) => ({ ...prev, status }));
          setIsWaiting(false);
          es.close();
          sseRef.current = null;
        }
      } catch {
        /* malformed event — ignore */
      }
    });

    es.onerror = () => {
      es.close();
      sseRef.current = null;
      // Reconnect after a short delay if still waiting
      setTimeout(() => setSseRetry((n) => n + 1), 5000);
    };

    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [isWaiting, reference, sseRetry]);

  const copyReferenceToClipboard = () => {
    if (!reference) return;

    navigator.clipboard
      .writeText(reference)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        console.error('Falha ao copiar: ', err);
      });
  };

  // Obter configuração baseada no status do pagamento
  // Status suportados: DRAFT, PENDING, COMPLETED, FAILED, REFUNDED, EXPIRED, IN_MEDIATION, CHARGEBACK, PENDING_REFUND
  const getStatusConfig = () => {
    const status = paymentData?.status?.toUpperCase();

    switch (status) {
      case 'COMPLETED':
      case 'APPROVED':
        return {
          icon: CheckCircle,
          iconColor: 'text-emerald-600',
          bgGradient: 'from-emerald-100 to-green-100',
          title: 'Pagamento Aprovado!',
          description:
            'Seu pagamento foi processado com sucesso! Você receberá um e-mail com o comprovante.',
          badgeColor: 'bg-green-500',
          badgeText: 'Aprovado',
          statusBadge: 'bg-green-100 text-green-800',
          statusText: 'Aprovado',
          showSuccess: true,
          isFinal: true,
        };

      case 'PENDING':
      case 'DRAFT':
        return {
          icon: Clock,
          iconColor: 'text-amber-600',
          bgGradient: 'from-amber-100 to-yellow-100',
          title: 'Aguardando Pagamento',
          description:
            'Seu pagamento está sendo processado. Isso pode levar alguns minutos. Esta página será atualizada automaticamente.',
          badgeColor: 'bg-amber-500',
          badgeText: 'Pendente',
          statusBadge: 'bg-amber-100 text-amber-800',
          statusText: 'Pendente',
          showSuccess: false,
          isFinal: false,
        };

      case 'FAILED':
        return {
          icon: XCircle,
          iconColor: 'text-red-600',
          bgGradient: 'from-red-100 to-pink-100',
          title: 'Pagamento Falhou',
          description:
            'Não foi possível processar seu pagamento. Por favor, tente novamente ou utilize outro método de pagamento.',
          badgeColor: 'bg-red-500',
          badgeText: 'Falhou',
          statusBadge: 'bg-red-100 text-red-800',
          statusText: 'Falhou',
          showSuccess: false,
          isFinal: true,
        };

      case 'EXPIRED':
        return {
          icon: Clock,
          iconColor: 'text-gray-600',
          bgGradient: 'from-gray-100 to-slate-100',
          title: 'Pagamento Expirado',
          description:
            'O tempo para realizar o pagamento expirou. Por favor, inicie uma nova transação.',
          badgeColor: 'bg-gray-500',
          badgeText: 'Expirado',
          statusBadge: 'bg-gray-100 text-gray-800',
          statusText: 'Expirado',
          showSuccess: false,
          isFinal: true,
        };

      case 'REFUNDED':
        return {
          icon: RotateCcw,
          iconColor: 'text-blue-600',
          bgGradient: 'from-blue-100 to-indigo-100',
          title: 'Pagamento Reembolsado',
          description:
            'O valor do pagamento foi devolvido. O reembolso pode levar alguns dias para aparecer na sua conta.',
          badgeColor: 'bg-blue-500',
          badgeText: 'Reembolsado',
          statusBadge: 'bg-blue-100 text-blue-800',
          statusText: 'Reembolsado',
          showSuccess: false,
          isFinal: true,
        };

      case 'PENDING_REFUND':
        return {
          icon: RotateCcw,
          iconColor: 'text-blue-600',
          bgGradient: 'from-blue-100 to-indigo-100',
          title: 'Reembolso em Processamento',
          description:
            'O reembolso está sendo processado. O valor será devolvido em breve.',
          badgeColor: 'bg-blue-500',
          badgeText: 'Reembolsando',
          statusBadge: 'bg-blue-100 text-blue-800',
          statusText: 'Reembolsando',
          showSuccess: false,
          isFinal: true,
        };

      case 'CHARGEBACK':
        return {
          icon: Ban,
          iconColor: 'text-red-700',
          bgGradient: 'from-red-100 to-red-200',
          title: 'Chargeback',
          description:
            'Este pagamento foi contestado pelo titular do cartão. Entre em contato com o suporte.',
          badgeColor: 'bg-red-700',
          badgeText: 'Chargeback',
          statusBadge: 'bg-red-100 text-red-800',
          statusText: 'Chargeback',
          showSuccess: false,
          isFinal: true,
        };

      case 'IN_MEDIATION':
        return {
          icon: AlertTriangle,
          iconColor: 'text-orange-600',
          bgGradient: 'from-orange-100 to-amber-100',
          title: 'Em Mediação',
          description:
            'Este pagamento está em processo de mediação. Aguarde a resolução ou entre em contato com o suporte.',
          badgeColor: 'bg-orange-500',
          badgeText: 'Em Mediação',
          statusBadge: 'bg-orange-100 text-orange-800',
          statusText: 'Em Mediação',
          showSuccess: false,
          isFinal: true,
        };

      default:
        return {
          icon: AlertCircle,
          iconColor: 'text-gray-600',
          bgGradient: 'from-gray-100 to-slate-100',
          title: 'Status Desconhecido',
          description:
            'Não foi possível verificar o status do seu pagamento. Entre em contato com o suporte.',
          badgeColor: 'bg-gray-500',
          badgeText: 'Desconhecido',
          statusBadge: 'bg-gray-100 text-gray-800',
          statusText: status || 'Desconhecido',
          showSuccess: false,
          isFinal: false,
        };
    }
  };

  const statusConfig = paymentData ? getStatusConfig() : null;
  const StatusIcon = statusConfig?.icon;

  // Função para renderizar conteúdo específico de cada status
  const renderStatusContent = () => {
    const status = paymentData?.status?.toUpperCase();

    // COMPLETED / APPROVED - Sucesso
    if (status === 'COMPLETED' || status === 'APPROVED') {
      const bookTitle = paymentData?.description
        ? sanitizeCheckoutText(
            removePixSuffix(
              String(paymentData.description)
                .replace(/^Pedido\s+ORD-\d{4}-\d{6}\s+-\s+/i, '')
                .trim(),
            ),
          )
        : null;

      return (
        <>
          {/* 3 info cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border border-white/60 p-6 text-center">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">
                Pagamento Aprovado
              </h3>
              <p className="text-sm text-gray-500">
                Transação processada com segurança
              </p>
            </div>
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border border-white/60 p-6 text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">
                Conteúdo Liberado
              </h3>
              <p className="text-sm text-gray-500">
                Acesse agora na sua biblioteca
              </p>
            </div>
            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-sm border border-white/60 p-6 text-center">
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-6 h-6 text-purple-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">
                E-mail Enviado
              </h3>
              <p className="text-sm text-gray-500">
                Comprovante na sua caixa de entrada
              </p>
            </div>
          </div>

          {/* Ebook purchased card */}
          {isEbookCheckout && bookTitle && (
            <div className="mb-6 rounded-2xl overflow-hidden shadow-lg border border-white/40">
              {/* gradient header */}
              <div className="bg-gradient-to-r from-emerald-600 to-cyan-600 px-6 py-4 flex items-center gap-3">
                <div className="w-9 h-9 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center flex-shrink-0">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">
                    Ebook adquirido
                  </p>
                  <p className="text-white/70 text-xs">
                    Disponível para download imediato
                  </p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm text-white text-xs font-medium px-3 py-1.5 rounded-full border border-white/30">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Pago
                </span>
              </div>
              {/* body */}
              <div className="bg-white/80 backdrop-blur-sm px-6 py-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-emerald-100 to-cyan-100 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl">
                    📖
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 text-base">
                      {bookTitle}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Acesse na sua biblioteca EbookSIM
                    </p>
                  </div>
                </div>
                <a
                  href="https://ebooksim.com/library"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 inline-flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-all shadow-sm"
                >
                  Acessar
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>
          )}
        </>
      );
    }

    // PENDING / DRAFT - Aguardando
    if (status === 'PENDING' || status === 'DRAFT') {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-amber-100 p-8 mb-8 text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-amber-600 animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Aguardando confirmação...
          </h3>
          <p className="text-gray-600 mb-4">
            Seu pagamento está sendo processado. Isso pode levar alguns minutos.
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Esta página será atualizada automaticamente quando o status mudar.
          </p>
          <div className="flex items-center justify-center gap-2 text-amber-600">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">
              Aguardando confirmação em tempo real...
            </span>
          </div>
        </div>
      );
    }

    // FAILED - Falhou
    if (status === 'FAILED') {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-8 mb-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="w-8 h-8 text-red-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Pagamento não foi concluído
          </h3>
          <p className="text-gray-600 mb-6">
            Houve um problema ao processar seu pagamento. Por favor, tente
            novamente ou escolha outro método de pagamento.
          </p>
          <button
            onClick={() => router.push('/')}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-8 rounded-xl transition duration-200 inline-flex items-center"
          >
            <ArrowRight className="w-5 h-5 mr-2" />
            Tentar Novamente
          </button>
        </div>
      );
    }

    // EXPIRED - Expirado
    if (status === 'EXPIRED') {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 mb-8 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-gray-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Pagamento Expirado
          </h3>
          <p className="text-gray-600 mb-6">
            O tempo para realizar o pagamento expirou. Por favor, inicie uma
            nova transação.
          </p>
          <button
            onClick={() => router.push('/')}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-8 rounded-xl transition duration-200 inline-flex items-center"
          >
            <ArrowRight className="w-5 h-5 mr-2" />
            Iniciar Nova Transação
          </button>
        </div>
      );
    }

    // REFUNDED - Reembolsado
    if (status === 'REFUNDED') {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-8 mb-8 text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <RotateCcw className="w-8 h-8 text-blue-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Pagamento Reembolsado
          </h3>
          <p className="text-gray-600 mb-4">
            O valor deste pagamento foi devolvido.
          </p>
          <p className="text-sm text-gray-500">
            O reembolso pode levar de 5 a 10 dias úteis para aparecer na sua
            conta, dependendo do seu banco.
          </p>
        </div>
      );
    }

    // PENDING_REFUND - Reembolso em processamento
    if (status === 'PENDING_REFUND') {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-blue-100 p-8 mb-8 text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <RotateCcw className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Reembolso em Processamento
          </h3>
          <p className="text-gray-600 mb-4">
            Seu reembolso está sendo processado.
          </p>
          <p className="text-sm text-gray-500">
            Você receberá uma confirmação assim que o reembolso for concluído.
          </p>
        </div>
      );
    }

    // CHARGEBACK
    if (status === 'CHARGEBACK') {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-8 mb-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Ban className="w-8 h-8 text-red-700" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Chargeback</h3>
          <p className="text-gray-600 mb-4">
            Este pagamento foi contestado pelo titular do cartão.
          </p>
          <p className="text-sm text-gray-500">
            Entre em contato com o suporte para mais informações.
          </p>
        </div>
      );
    }

    // IN_MEDIATION - Em mediação
    if (status === 'IN_MEDIATION') {
      return (
        <div className="bg-white rounded-2xl shadow-sm border border-orange-100 p-8 mb-8 text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-orange-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Em Mediação</h3>
          <p className="text-gray-600 mb-4">
            Este pagamento está em processo de mediação.
          </p>
          <p className="text-sm text-gray-500">
            Aguarde a resolução ou entre em contato com o suporte para mais
            informações.
          </p>
        </div>
      );
    }

    // Default - Status desconhecido
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-8 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-gray-600" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">
          Status: {status || 'Desconhecido'}
        </h3>
        <p className="text-gray-600">
          Não foi possível verificar o status do seu pagamento. Entre em contato
          com o suporte.
        </p>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="animate-pulse text-center">
          <div className="h-24 w-24 bg-gray-200 rounded-full mx-auto mb-4"></div>
          <div className="h-8 w-48 bg-gray-200 rounded mx-auto mb-4"></div>
          <div className="h-4 w-64 bg-gray-200 rounded mx-auto"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md text-center">
          <div className="text-red-500 mx-auto mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-4">
            Ops! Algo deu errado
          </h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-6 rounded-xl transition duration-200"
          >
            Voltar para a página inicial
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{
        background:
          'linear-gradient(135deg, #0f172a 0%, #134e4a 50%, #0f172a 100%)',
      }}
    >
      {/* Decorative blur blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-80 h-80 bg-cyan-500/15 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <div className="relative z-10 bg-white/5 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">S</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">SIM INT</h1>
                <p className="text-xs text-white/50">Pagamentos</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 text-emerald-400">
              <Shield className="w-4 h-4" />
              <span className="text-sm font-medium">Transação Segura</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 max-w-4xl mx-auto px-4 py-12">
        {/* Status Hero */}
        <div className="text-center mb-10">
          <div
            className={`inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-r ${statusConfig?.bgGradient} mb-6 shadow-2xl ${isWaiting ? 'animate-pulse' : ''}`}
          >
            {StatusIcon && (
              <StatusIcon className={`w-12 h-12 ${statusConfig?.iconColor}`} />
            )}
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">
            {statusConfig?.title}
          </h1>
          <p className="text-lg text-white/70 max-w-2xl mx-auto">
            {statusConfig?.description}
          </p>

          {isWaiting && (
            <div className="mt-4 inline-flex items-center gap-2 text-amber-300 bg-amber-500/10 backdrop-blur-sm border border-amber-500/20 px-4 py-2 rounded-full">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm font-medium">
                Aguardando confirmação em tempo real...
              </span>
            </div>
          )}
        </div>

        {/* Status Cards */}
        {renderStatusContent()}

        {/* Payment Details Card */}
        <div className="bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 overflow-hidden mb-8 shadow-xl">
          {/* Card Header */}
          <div className="bg-gradient-to-r from-emerald-600 to-cyan-600 p-6 text-white">
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-3">
                <CreditCard className="w-6 h-6" />
                <div>
                  <h2 className="text-xl font-bold">Detalhes do Pagamento</h2>
                  <p className="text-white/70 text-sm">
                    Referência: #{reference}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <div
                  className={`${statusConfig?.badgeColor} text-white px-3 py-1 rounded-full text-sm font-medium`}
                >
                  {statusConfig?.badgeText}
                </div>
                <button
                  onClick={copyReferenceToClipboard}
                  className="bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded-lg text-sm flex items-center transition"
                >
                  {copied ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" />
                      Copiar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Card Content */}
          <div className="p-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <h3 className="text-base font-bold text-white mb-5 flex items-center">
                  <Star className="w-4 h-4 mr-2 text-amber-400" />
                  Informações do Pagamento
                </h3>
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-3 border-b border-white/10">
                    <span className="text-white/60 text-sm">Descrição</span>
                    <span className="font-semibold text-white text-sm text-right max-w-[200px]">
                      {sanitizeCheckoutText(
                        removePixSuffix(
                          paymentData?.description || 'Pagamento único',
                        ),
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-3">
                    <span className="text-white/60 text-sm">Status</span>
                    <span
                      className={`${statusConfig?.statusBadge} px-3 py-1 rounded-full text-xs font-medium`}
                    >
                      {statusConfig?.statusText}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-base font-bold text-white mb-5 flex items-center">
                  <CreditCard className="w-4 h-4 mr-2 text-cyan-400" />
                  Informações do Cliente
                </h3>
                <div className="space-y-0">
                  <div className="flex justify-between items-center py-3 border-b border-white/10">
                    <span className="text-white/60 text-sm">
                      Método de Pagamento
                    </span>
                    <div className="flex items-center text-white font-medium text-sm">
                      {paymentData?.payment_method === 'pix' ? (
                        <span className="flex items-center gap-1.5">
                          <span>💚</span> PIX
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <CreditCard className="w-4 h-4 text-white/50" />{' '}
                          Cartão
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center py-3">
                    <span className="text-white/60 text-sm">
                      ID da Transação
                    </span>
                    <span className="font-mono text-xs text-white/70 bg-white/10 px-2 py-1 rounded">
                      {reference}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-10 pt-8 border-t border-white/10">
          <p className="text-sm text-white/40 mb-3">
            Powered by{' '}
            <span className="font-semibold text-emerald-400">
              SIM INT Pagamentos
            </span>
          </p>
          <div className="flex items-center justify-center space-x-6 text-xs text-white/30">
            <button className="hover:text-white/60 transition">
              Termos de Uso
            </button>
            <button className="hover:text-white/60 transition">
              Política de Privacidade
            </button>
            <button className="hover:text-white/60 transition">Ajuda</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const PaymentSuccessPage = () => {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="animate-pulse text-center">
            <div className="h-24 w-24 bg-gray-200 rounded-full mx-auto mb-4"></div>
            <div className="h-8 w-48 bg-gray-200 rounded mx-auto mb-4"></div>
            <div className="h-4 w-64 bg-gray-200 rounded mx-auto"></div>
          </div>
        </div>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
};

export default PaymentSuccessPage;
