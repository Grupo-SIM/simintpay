'use client';

import { Dropdown } from '@/components/ui/Dropdown';
import { EBOOK_API_URL, SIM_API_URL } from '@/lib/api-config';

import { EmailNoticeModal } from '@/components/checkout/EmailNoticeModal';
import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

const Cards = dynamic(() => import('react-credit-cards-2'), {
  ssr: false,
  loading: () => null,
});
import {
  CreditCard,
  // Calendar,
  // Lock,
  // User,
  // CreditCard as CardIcon,
  CheckCircle,
  AlertCircle,
  Copy,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getTokenCard } from '@/components/sdk';
import { usePixPlanSuffix } from '@/hooks/usePixPlanSuffix';
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow';
import {
  CheckoutGlassField,
  CheckoutGlassInput,
} from '@/components/checkout/CheckoutFormPrimitives';
import { CheckoutCardPreview } from '@/components/checkout/CheckoutLayout';
import { CheckoutStatusCard } from '@/components/checkout/CheckoutStatusCard';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import { buildInstallmentLabel } from '@/lib/installment-label';
import { checkoutTracking } from '@/lib/payment-tracking';
import { fetchDomPublicKey } from '@/lib/dom-public-key';

const SIMPAY_API_BASE_URL = SIM_API_URL;
const BACK_EBOOK_API_BASE_URL = EBOOK_API_URL;

const CheckoutForm = () => {
  const { removePixSuffix } = usePixPlanSuffix();
  const router = useRouter();
  const searchParams = useSearchParams();
  const valueParam = searchParams.get('value');
  const descriptionParam = searchParams.get('description');
  const orderNumber = searchParams.get('orderNumber');
  const settlementId = searchParams.get('settlementId');
  const settlementToken = searchParams.get('settlementToken');
  const storeParam = searchParams.get('store');
  const orderIdFromQuery =
    searchParams.get('orderId') || searchParams.get('id');
  const maxInstallmentsParam = searchParams.get('maxInstallments');
  const normalizedStore = String(storeParam || '').toLowerCase();
  const isEbookCheckout =
    normalizedStore === 'ebook' || normalizedStore === 'ebooksim';
  const isPagatgHost =
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('pagatg') ||
      window.location.hostname.includes('jbmidia') ||
      window.location.hostname.includes('localhost'));

  // Estado para controlar a etapa atual do formulário

  const [formData, setFormData] = useState<any>({
    name: '',
    document: '',
    number: '',
    cvv: '',
    month: '',
    year: '',
    installments: 1,
    email: '',
    mobilePhone: '',
    holder_name: '',
    holder_document: '',
  });

  // Estado para controlar se os dados do titular são os mesmos do comprador
  const [sameAsCustomer, setSameAsCustomer] = useState(false);

  const [paymentData, setPaymentData] = useState<any>({
    token: '',
    brand: '',
    bin: '',
  });

  const [ebookInstallmentOptions, setEbookInstallmentOptions] = useState<any[]>(
    [],
  ); // Opções de parcelas para ebook (MDR_CC_MASTER)
  const [mounted, setMounted] = useState(false);

  const [cardFocused, setCardFocused] = useState<
    'number' | 'expiry' | 'cvc' | 'name' | ''
  >('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [formErrors, setFormErrors] = useState<any>({});
  const orderId = searchParams.get('id');
  const [orderData, setOrderData] = useState<any>(null);

  // ESTADO: adicionar método de pagamento, valor e descrição para pagamento único
  const [paymentMethod, setPaymentMethod] = useState('pix'); // "credit" ou "pix"
  const [singleValue, setSingleValue] = useState(0);
  const [singleDescription, setSingleDescription] = useState('');
  const [pixData, setPixData] = useState<any>(null); // dados do PIX (qr code, etc)
  const [copiedPix, setCopiedPix] = useState(false);
  const [pixPaymentId, setPixPaymentId] = useState<string>(''); // ID do pagamento PIX
  const [pixStatus, setPixStatus] = useState<string>('pending'); // status do pagamento PIX
  const [customFees, setCustomFees] = useState<any>(null); // taxas customizadas

  // Estado para controlar o modal de e-mail
  const [showEmailModal, setShowEmailModal] = useState(false);

  const buildPaymentSuccessUrl = (reference?: string) => {
    const params = new URLSearchParams();
    if (reference) params.set('reference', reference);
    if (storeParam) params.set('store', storeParam);
    if (orderIdFromQuery) params.set('orderId', orderIdFromQuery);
    if (orderNumber) params.set('orderNumber', orderNumber);
    return `/payment/success?${params.toString()}`;
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Pagamento direto: valor e descrição vêm da URL (sistemas vizinhos: ebook, pagatg).
  useEffect(() => {
    if (valueParam) setSingleValue(Number(valueParam));
    if (descriptionParam) setSingleDescription(descriptionParam);
  }, [valueParam, descriptionParam]);

  // Buscar opções de parcelamento para ebook (MDR_CC_MASTER) — sempre busca para ter o totalAmount com taxa
  useEffect(() => {
    if (!isEbookCheckout || !singleValue || singleValue <= 0) return;
    const max = Math.max(1, Number(maxInstallmentsParam) || 1);

    const fetchEbookInstallments = async () => {
      try {
        const resp = await fetch(
          `${SIMPAY_API_BASE_URL}/checkout/card/installment-options`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              price: singleValue / 100,
              store: storeParam || 'ebook',
              maxInstallments: max,
            }),
          },
        );
        if (!resp.ok) return;
        const data = await resp.json();
        if (Array.isArray(data?.options)) {
          setEbookInstallmentOptions(data.options);
        }
      } catch {
        // Silencioso — o dropdown de parcelas simplesmente não aparece
      }
    };
    fetchEbookInstallments();
  }, [isEbookCheckout, singleValue, maxInstallmentsParam, storeParam]);

  // Mostrar modal de e-mail automaticamente após carregar
  useEffect(() => {
    // Verificar se o modal já foi mostrado antes
    const modalShown = localStorage.getItem('emailModalShown');
    if (modalShown) return;
    const timer = setTimeout(() => {
      setShowEmailModal(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Token do vendedor para pagamentos diretos (sem fallback fixo)
  useEffect(() => {
    const adminToken = searchParams.get('adminToken');
    if (adminToken) setToken(adminToken);
  }, [searchParams]);

  // Buscar valor real do pedido se houver id ou orderId
  useEffect(() => {
    const orderId = searchParams.get('orderId') || searchParams.get('id');
    if (orderId) {
      fetch(`${EBOOK_API_URL}/checkout/orders/${orderId}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer checkout-token-2025-simint', // Token especial
        },
      })
        .then((res) => {
          if (!res.ok) {
            throw new Error(`Erro ao buscar pedido: ${res.status}`);
          }
          return res.json();
        })
        .then((data) => {
          console.log('Dados do pedido carregados:', data);
          console.log('Descrição do pedido:', data.description);
          console.log('Items do pedido:', data.items);
          setOrderData(data);
        })
        .catch((err) => {
          console.error('Erro ao buscar dados do pedido:', err);
        });
    }
  }, [searchParams]);
  // Efeito para atualizar os dados do titular quando sameAsCustomer muda
  useEffect(() => {
    if (sameAsCustomer) {
      setFormData((prev: any) => ({
        ...prev,
        holder_name: prev.name,
        holder_document: prev.document,
      }));
    }
  }, [sameAsCustomer, formData.name, formData.document]);

  const validateStep1 = () => {
    const errors: any = {};

    if (!formData.name.trim()) {
      errors.name = 'Nome é obrigatório';
    }

    if (!formData.document.trim()) {
      errors.document = 'CPF/CNPJ é obrigatório';
    } else if (
      formData.document.replace(/\D/g, '').length !== 11 &&
      formData.document.replace(/\D/g, '').length !== 14
    ) {
      errors.document = 'CPF/CNPJ inválido';
    }

    if (!formData.email.trim()) {
      errors.email = 'E-mail é obrigatório';
    } else if (!/^\S+@\S+\.\S+$/.test(formData.email)) {
      errors.email = 'E-mail inválido';
    }

    if (!formData.mobilePhone.trim()) {
      errors.mobilePhone = 'Telefone é obrigatório';
    } else if (formData.mobilePhone.replace(/\D/g, '').length < 10) {
      errors.mobilePhone = 'Telefone inválido';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateStep2 = () => {
    const errors: any = {};

    if (!formData.holder_name.trim()) {
      errors.holder_name = 'Nome do titular é obrigatório';
    }

    if (!formData.holder_document.trim()) {
      errors.holder_document = 'CPF/CNPJ do titular é obrigatório';
    }

    if (!formData.number.trim()) {
      errors.number = 'Número do cartão é obrigatório';
    } else if (formData.number.replace(/\D/g, '').length < 13) {
      errors.number = 'Número do cartão inválido';
    }

    if (!formData.month) {
      errors.month = 'Mês é obrigatório';
    }

    if (!formData.year) {
      errors.year = 'Ano é obrigatório';
    }

    if (!formData.cvv) {
      errors.cvv = 'CVV é obrigatório';
    } else if (formData.cvv.length < 3) {
      errors.cvv = 'CVV inválido';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // handle para método de pagamento — só troca o método, não apaga dados
  const handlePaymentMethodChange = (e: any) => {
    setPaymentMethod(e.target.value);
    setError('');
    setPixData(null);
  };

  // NOVA FUNÇÃO: handle para valor e descrição de pagamento único
  const handleSingleValueChange = (e: any) => {
    setSingleValue(Number(e.target.value.replace(/\D/g, '')));
  };
  const handleSingleDescriptionChange = (e: any) => {
    setSingleDescription(e.target.value);
  };

  // NOVA FUNÇÃO: handle para pagamento PIX único
  const handlePixPayment = async () => {
    setLoading(true);
    setError('');
    setPixData(null);
    try {
      // Montar body conforme CheckoutPix
      const body = {
        description: getOrderDescription(),
        name: formData.name,
        email: formData.email,
        document_type:
          formData.document.replace(/\D/g, '').length <= 11 ? 'CPF' : 'CNPJ',
        document: formData.document.replace(/\D/g, ''),
        mobile_phone: formData.mobilePhone.replace(/\D/g, ''),
        store: storeParam,
        price: getDisplayValue(),
        ...(orderNumber ? { orderNumber } : {}),
        ...(settlementId ? { settlementId, settlementToken } : {}),
      };

      const response = await fetch(`${SIMPAY_API_BASE_URL}/checkout/pix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...body,
          tracking: checkoutTracking(
            window.location.search,
            window.document.cookie,
          ),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data?.message || 'Erro ao criar pagamento PIX');
        setLoading(false);
        return;
      }

      // Capturar o ID do pagamento para polling
      if (data.id) {
        setPixPaymentId(data.id);
      }

      setPixData(data); // Exibir QR Code
      setLoading(false);
    } catch (err) {
      setError('Erro ao criar pagamento PIX. Tente novamente.');
      setLoading(false);
    }
  };

  // Pagamento direto (valor/descrição vindos da URL): PIX ou cartão.
  const handleSubmit = async () => {
    // PAGAMENTO PIX: não validar etapa 2 de cartão
    if (paymentMethod === 'pix') {
      await handlePixPayment();
      return;
    }
    // Validação etapa 2 (apenas para cartão)
    const isValid = validateStep2();
    if (!isValid) return;
    setLoading(true);
    setError('');
    setPixData(null);

    // PAGAMENTO ÚNICO - CARTÃO
    try {
      const public_key = await fetchDomPublicKey();
      const data_card = formatCardData({
        name: formData.holder_name,
        document: formData.holder_document,
        number: formData.number,
        cvv: formData.cvv,
        month: formData.month,
        year: formData.year,
      });
      const response = await getTokenCard(public_key, data_card, 1);
      if (response.token) {
        setPaymentData({
          token: response.token,
          brand: response.brand,
          bin: response.bin,
        });
        // Montar body conforme CreditCardPaymentDto
        const body = {
          price: getDisplayValue(),
          holder_name: formData.holder_name,
          token: response.token,
          bin: response.bin,
          brand: response.brand,
          installments: formData.installments,
          description: getOrderDescription(),
          email: formData.email,
          document: formData.document.replace(/\D/g, ''),
          document_type:
            formData.document.replace(/\D/g, '').length <= 11 ? 'CPF' : 'CNPJ',
          mobile_phone: formData.mobilePhone.replace(/\D/g, ''),
          name: formData.name,
          store: storeParam,
          ...(orderNumber ? { orderNumber } : {}),
          ...(settlementId ? { settlementId, settlementToken } : {}),
        };
        const cardEndpoint = isEbookCheckout
          ? `${SIMPAY_API_BASE_URL}/checkout/card`
          : `${SIMPAY_API_BASE_URL}/checkout/card`;
        const cardHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (!isEbookCheckout) cardHeaders['x-access-token'] = token;
        const subscriptionResponse = await fetch(cardEndpoint, {
          method: 'POST',
          headers: cardHeaders,
          body: JSON.stringify({
            ...body,
            tracking: checkoutTracking(
              window.location.search,
              window.document.cookie,
            ),
          }),
        });
        const responseData = await subscriptionResponse.json();
        if (!subscriptionResponse.ok) {
          setError(responseData?.message ?? 'Erro ao processar pagamento');
          setLoading(false);
          return;
        }
        // Redirecionar para página de sucesso de pagamento único
        router.push(buildPaymentSuccessUrl(responseData.id));
      } else {
        setError(response.msgError || 'Erro ao processar pagamento');
      }
      setLoading(false);
    } catch (err) {
      setError('Erro ao processar pagamento. Tente novamente.');
      setLoading(false);
    }
  };
  const formatCardData = (cardData: any): any => ({
    name: cardData.name,
    document: cardData.document.replace(/\D/g, ''),
    customer_id: cardData.customer_id || '',
    number: String(
      String(cardData.number).replace(/\s+/g, '').replace(/\D/g, ''),
    ),
    cvv: cardData.cvv.replace(/\s/g, ''),
    month: cardData.month,
    year:
      parseInt(cardData.year) < 100
        ? parseInt(cardData.year) + 2000
        : parseInt(cardData.year),
  });

  const handleChange = (e: any) => {
    const { name, value } = e.target;

    let formattedValue = value;

    // Formatação do número do cartão
    if (name === 'number') {
      formattedValue = value
        .replace(/\D/g, '')
        .replace(/(\d{4})/g, '$1 ')
        .trim()
        .slice(0, 19); // Limit to 16 digits + spaces
    }

    // Formatação do CPF/CNPJ
    if (name === 'document' || name === 'holder_document') {
      if (value.replace(/\D/g, '').length <= 11) {
        // CPF
        formattedValue = value
          .replace(/\D/g, '')
          .replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d{1,2})/, '$1-$2')
          .replace(/(-\d{2})\d+?$/, '$1');
      } else {
        // CNPJ
        formattedValue = value
          .replace(/\D/g, '')
          .replace(/^(\d{2})(\d)/, '$1.$2')
          .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
          .replace(/\.(\d{3})(\d)/, '.$1/$2')
          .replace(/(\d{4})(\d)/, '$1-$2')
          .replace(/(-\d{2})\d+?$/, '$1');
      }
    }

    // Formatação do telefone
    if (name === 'mobilePhone') {
      formattedValue = value
        .replace(/\D/g, '')
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2')
        .replace(/(-\d{4})\d+?$/, '$1');
    }

    // Formatação do CVV
    if (name === 'cvv') {
      formattedValue = value.replace(/\D/g, '').slice(0, 4);
    }

    // Converter installments para número
    if (name === 'installments') {
      formattedValue = parseInt(value, 10);
    }

    // Se o usuário estiver editando os dados do cliente e o sameAsCustomer estiver ativo
    if ((name === 'name' || name === 'document') && sameAsCustomer) {
      const holderField = name === 'name' ? 'holder_name' : 'holder_document';
      setFormData((prev: any) => ({
        ...prev,
        [name]: formattedValue,
        [holderField]: formattedValue,
      }));
    } else {
      setFormData((prev: any) => ({ ...prev, [name]: formattedValue }));
    }
  };

  const handleSameAsCustomerChange = (e: any) => {
    const checked = e.target.checked;
    setSameAsCustomer(checked);

    if (checked) {
      setFormData((prev: any) => ({
        ...prev,
        holder_name: prev.name,
        holder_document: prev.document,
      }));
    }
  };

  const formatCurrency = (value: any) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value); // Valor já está em reais, não dividir por 100
  };

  // Descrição enviada ao gateway (inclui orderNumber para rastreamento DOM)
  const getOrderDescription = (): string => {
    if (orderData) {
      const ord = orderData.orderNumber || orderNumber;
      if (orderData.items && orderData.items.length > 0) {
        const firstItem = orderData.items[0];
        const title = firstItem.bookTitle || firstItem.name || 'Produto';
        return ord ? `Pedido ${ord} - ${title}` : title;
      }
      if (orderData.description) {
        return ord
          ? `Pedido ${ord} - ${orderData.description}`
          : orderData.description;
      }
      if (ord) return `Pedido ${ord}`;
    }
    if (orderNumber) {
      return `Pedido ${orderNumber}${singleDescription ? ` - ${singleDescription}` : ''}`;
    }
    return singleDescription || 'Pagamento único';
  };

  // Título exibido no checkout — apenas o nome do produto/livro, sem o número do pedido
  const getDisplayTitle = (): string => {
    if (orderData) {
      if (orderData.items && orderData.items.length > 0) {
        const firstItem = orderData.items[0];
        return firstItem.bookTitle || firstItem.name || 'Produto';
      }
      if (orderData.description) return orderData.description;
    }
    return singleDescription || 'Pagamento único';
  };

  // Função para obter o valor correto do pedido
  const getDisplayValue = () => {
    // Ebook checkout: PIX usa valor base, cartão usa totalAmount com taxa MDR_CC_MASTER
    if (isEbookCheckout) {
      const base =
        singleValue > 0 ? singleValue / 100 : (orderData?.amount ?? 0);
      if (paymentMethod === 'credit' && ebookInstallmentOptions.length > 0) {
        const selectedInstallments = Number(formData.installments) || 1;
        const opt =
          ebookInstallmentOptions.find(
            (o: any) => o.installments === selectedInstallments,
          ) ?? ebookInstallmentOptions[0];
        return opt?.totalAmount ?? base;
      }
      return base;
    }

    // Priorizar orderData se existir (outros fluxos não-ebook)
    if (orderData && orderData.totalAmount) {
      return orderData.totalAmount;
    }

    // Se for pagamento único via URL params
    if (singleValue > 0) {
      return singleValue;
    }

    // Fallback para valor via URL params
    if (valueParam) {
      return Number(valueParam);
    }

    return 0;
  };

  // SSE primário + polling de fallback para confirmação de pagamento PIX
  useEffect(() => {
    if (!pixPaymentId || pixStatus === 'completed') return;

    let done = false;

    const handleCompleted = () => {
      if (done) return;
      done = true;
      setPixStatus('completed');
      router.push(buildPaymentSuccessUrl(pixPaymentId));
    };

    // SSE: confirmação instantânea via webhook da DOM
    let eventSource: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1500;

    const checkStatusFallback = async () => {
      if (done) return;
      try {
        const r = await fetch(
          `${SIMPAY_API_BASE_URL}/checkout/pix/${pixPaymentId}/status`,
        );
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
      try {
        eventSource = new EventSource(
          `${SIMPAY_API_BASE_URL}/checkout/pix/${pixPaymentId}/sse`,
        );
        eventSource.addEventListener(
          'payment-status',
          (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data);
              if (data.status === 'COMPLETED') handleCompleted();
            } catch {
              /* ignore */
            }
          },
        );
        // heartbeat indica conexão saudável — volta ao retry rápido
        eventSource.addEventListener('heartbeat', () => {
          retryDelay = 1500;
        });
        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
          if (done) return;
          // Confere se o pagamento passou enquanto a conexão estava caída
          void checkStatusFallback();
          retryTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 8000);
            connect();
          }, retryDelay);
        };
      } catch {
        /* ignore */
      }
    };

    connect();

    return () => {
      done = true;
      eventSource?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [pixPaymentId, pixStatus, router]);

  // Itens de status para o CheckoutStatusCard
  const dadosOk =
    formData.name.trim().length >= 2 &&
    (formData.document.replace(/\D/g, '').length === 11 ||
      formData.document.replace(/\D/g, '').length === 14) &&
    formData.mobilePhone.replace(/\D/g, '').length >= 10 &&
    formData.email.includes('@');
  const cartaoOk =
    formData.number.replace(/\D/g, '').length >= 13 &&
    formData.month.length === 2 &&
    formData.year.length >= 2 &&
    formData.cvv.length >= 3 &&
    formData.holder_name.trim().length >= 2 &&
    (formData.holder_document.replace(/\D/g, '').length === 11 ||
      formData.holder_document.replace(/\D/g, '').length === 14);

  const statusItems =
    paymentMethod === 'pix'
      ? [
          { ok: dadosOk, label: 'Dados pessoais completos' },
          { ok: true, label: 'Forma: PIX selecionada' },
        ]
      : [
          { ok: dadosOk, label: 'Dados pessoais completos' },
          { ok: cartaoOk, label: 'Cartão e titular completos' },
        ];

  return (
    <>
      <CheckoutFlow
        product={{
          title: sanitizeCheckoutText(removePixSuffix(getDisplayTitle())),
          price: formatCurrency(getDisplayValue()),
          frequency: 'Pagamento único',
        }}
        total={formatCurrency(getDisplayValue())}
        status={<CheckoutStatusCard error={error} items={statusItems} />}
        validateDados={validateStep1}
        onSubmit={handleSubmit}
        onStepChange={() => setError('')}
        finalLabel="Finalizar Pagamento"
        loading={loading}
        error={error}
        finalAction={
          paymentMethod === 'pix' && pixData ? (
            <p className="text-center text-sm text-[#a9a3b8]">
              Aguardando pagamento…
            </p>
          ) : undefined
        }
        dados={
          <div className="flex flex-col gap-3 pt-1">
            <CheckoutGlassField label="Nome completo" required>
              <CheckoutGlassInput
                name="name"
                placeholder="Digite seu nome completo"
                value={formData.name}
                onChange={(v) =>
                  handleChange({
                    target: { name: 'name', value: v },
                  } as any)
                }
                autoComplete="name"
              />
              {formErrors.name && (
                <p className="mt-1 text-xs text-red-400">{formErrors.name}</p>
              )}
            </CheckoutGlassField>

            <CheckoutGlassField label="CPF / CNPJ" required>
              <CheckoutGlassInput
                name="document"
                placeholder="000.000.000-00 ou 00.000.000/0000-00"
                value={formData.document}
                onChange={(v) =>
                  handleChange({
                    target: { name: 'document', value: v },
                  } as any)
                }
                inputMode="numeric"
                autoComplete="off"
              />
              {formErrors.document && (
                <p className="mt-1 text-xs text-red-400">
                  {formErrors.document}
                </p>
              )}
            </CheckoutGlassField>

            <CheckoutGlassField label="E-mail" required>
              <div className="mb-2 rounded-lg border border-[rgba(246,182,122,.35)] bg-[rgba(245,138,42,.12)] px-3 py-2">
                <p className="text-xs text-[#d9d4e3]">
                  Use o <strong>mesmo e-mail</strong>{' '}
                  {isPagatgHost
                    ? 'vinculado à sua assinatura do canal/grupo.'
                    : 'que você utilizou para se cadastrar na plataforma.'}
                </p>
              </div>
              <CheckoutGlassInput
                type="email"
                name="email"
                placeholder={
                  isPagatgHost
                    ? 'exemplo@email.com (mesmo e-mail da assinatura)'
                    : 'exemplo@email.com (mesmo e-mail do seu cadastro)'
                }
                value={formData.email}
                onChange={(v) =>
                  handleChange({
                    target: { name: 'email', value: v },
                  } as any)
                }
                autoComplete="email"
              />
              {formErrors.email && (
                <p className="mt-1 text-xs text-red-400">{formErrors.email}</p>
              )}
            </CheckoutGlassField>

            <CheckoutGlassField label="Telefone" required>
              <CheckoutGlassInput
                name="mobilePhone"
                prefix="+55"
                placeholder="(00) 00000-0000"
                value={formData.mobilePhone}
                onChange={(v) =>
                  handleChange({
                    target: { name: 'mobilePhone', value: v },
                  } as any)
                }
                inputMode="tel"
                autoComplete="tel-national"
              />
              {formErrors.mobilePhone && (
                <p className="mt-1 text-xs text-red-400">
                  {formErrors.mobilePhone}
                </p>
              )}
            </CheckoutGlassField>
          </div>
        }
        pagamento={
          <div className="flex flex-col gap-3 pt-1">
            {/* Seletor de método (apenas quando aplicável) */}
            <div className="flex flex-wrap items-center gap-4 rounded-[20px] border border-white/[0.07] bg-white/[0.06] px-4 py-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-200">
                <input
                  type="radio"
                  name="paymentMethod"
                  className="h-4 w-4 accent-[#f58a2a]"
                  value="credit"
                  checked={paymentMethod === 'credit'}
                  onChange={handlePaymentMethodChange}
                />
                <CreditCard className="h-4 w-4 shrink-0 text-[#d9d4e3]" />
                Cartão de Crédito
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-zinc-200">
                <input
                  type="radio"
                  name="paymentMethod"
                  className="h-4 w-4 accent-[#f58a2a]"
                  value="pix"
                  checked={paymentMethod === 'pix'}
                  onChange={handlePaymentMethodChange}
                />
                PIX
              </label>
            </div>

            {/* ── Cartão de crédito ── */}
            {paymentMethod === 'credit' && (
              <>
                {/* Preview visual do cartão */}
                {mounted && (
                  <CheckoutCardPreview>
                    <Cards
                      number={formData.number}
                      expiry={`${formData.month}/${formData.year}`}
                      cvc={formData.cvv}
                      name={formData.holder_name || ' '}
                      focused={cardFocused}
                    />
                  </CheckoutCardPreview>
                )}

                {/* Checkbox: titular = comprador */}
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm font-medium text-zinc-200">
                  <input
                    type="checkbox"
                    id="sameAsCustomer"
                    checked={sameAsCustomer}
                    onChange={handleSameAsCustomerChange}
                    className="h-4 w-4 accent-[#f58a2a]"
                  />
                  <Copy className="h-4 w-4 shrink-0 text-[#f6b67a]" />O titular
                  do cartão é o mesmo que está fazendo a compra
                </label>

                {/* Parcelas — ebook com maxInstallments >= 1 */}
                {isEbookCheckout && ebookInstallmentOptions.length >= 1 && (
                  <CheckoutGlassField label="Número de parcelas" required>
                    <Dropdown
                      ariaLabel="Número de parcelas"
                      value={String(formData.installments)}
                      onChange={(value) =>
                        setFormData((previous: typeof formData) => ({
                          ...previous,
                          installments: Number(value),
                        }))
                      }
                      options={ebookInstallmentOptions.map((opt) => {
                        // "(com juros)" só quando a opção tem juros de fato.
                        const label = buildInstallmentLabel({
                          installments: opt.installments,
                          perInstallment: opt.installmentAmount,
                          total:
                            opt.totalAmount ??
                            opt.installmentAmount * opt.installments,
                          interestAmount: opt.interestAmount,
                          formatCurrency,
                        });
                        return { value: String(opt.installments), label };
                      })}
                    />
                  </CheckoutGlassField>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <CheckoutGlassField label="Nome do titular" required>
                    <CheckoutGlassInput
                      name="holder_name"
                      placeholder="Nome como está no cartão"
                      value={formData.holder_name}
                      onChange={(v) =>
                        handleChange({
                          target: { name: 'holder_name', value: v },
                        } as any)
                      }
                      onFocus={() => setCardFocused('name')}
                      autoComplete="cc-name"
                    />
                    {formErrors.holder_name && (
                      <p className="mt-1 text-xs text-red-400">
                        {formErrors.holder_name}
                      </p>
                    )}
                  </CheckoutGlassField>

                  <CheckoutGlassField label="CPF / CNPJ do titular" required>
                    <CheckoutGlassInput
                      name="holder_document"
                      placeholder="000.000.000-00"
                      value={formData.holder_document}
                      onChange={(v) =>
                        handleChange({
                          target: { name: 'holder_document', value: v },
                        } as any)
                      }
                      inputMode="numeric"
                      autoComplete="off"
                    />
                    {formErrors.holder_document && (
                      <p className="mt-1 text-xs text-red-400">
                        {formErrors.holder_document}
                      </p>
                    )}
                  </CheckoutGlassField>
                </div>

                <CheckoutGlassField label="Número do cartão" required>
                  <CheckoutGlassInput
                    name="number"
                    placeholder="1234 5678 9012 3456"
                    value={formData.number}
                    onChange={(v) =>
                      handleChange({
                        target: { name: 'number', value: v },
                      } as any)
                    }
                    onFocus={() => setCardFocused('number')}
                    inputMode="numeric"
                    autoComplete="cc-number"
                  />
                  {formErrors.number && (
                    <p className="mt-1 text-xs text-red-400">
                      {formErrors.number}
                    </p>
                  )}
                </CheckoutGlassField>

                <div className="grid grid-cols-3 gap-3">
                  <CheckoutGlassField label="Mês" required>
                    <Dropdown
                      ariaLabel="Mês"
                      value={String(formData.month)}
                      onChange={(value) =>
                        setFormData((previous: typeof formData) => ({
                          ...previous,
                          month: value,
                        }))
                      }
                      options={[
                        { value: '', label: 'MM' },
                        ...Array.from({ length: 12 }, (_, i) => {
                          const value = (i + 1).toString().padStart(2, '0');
                          return { value, label: value };
                        }),
                      ]}
                    />
                    {formErrors.month && (
                      <p className="mt-1 text-xs text-red-400">
                        {formErrors.month}
                      </p>
                    )}
                  </CheckoutGlassField>

                  <CheckoutGlassField label="Ano" required>
                    <Dropdown
                      ariaLabel="Ano"
                      value={String(formData.year)}
                      onChange={(value) =>
                        setFormData((previous: typeof formData) => ({
                          ...previous,
                          year: value,
                        }))
                      }
                      options={[
                        { value: '', label: 'AA' },
                        ...Array.from({ length: 10 }, (_, i) => {
                          const value = (new Date().getFullYear() + i)
                            .toString()
                            .slice(-2);
                          return { value, label: value };
                        }),
                      ]}
                    />
                    {formErrors.year && (
                      <p className="mt-1 text-xs text-red-400">
                        {formErrors.year}
                      </p>
                    )}
                  </CheckoutGlassField>

                  <CheckoutGlassField label="CVV" required>
                    <CheckoutGlassInput
                      name="cvv"
                      placeholder="123"
                      value={formData.cvv}
                      onChange={(v) =>
                        handleChange({
                          target: { name: 'cvv', value: v },
                        } as any)
                      }
                      onFocus={() => setCardFocused('cvc')}
                      inputMode="numeric"
                      maxLength={4}
                      autoComplete="cc-csc"
                    />
                    {formErrors.cvv && (
                      <p className="mt-1 text-xs text-red-400">
                        {formErrors.cvv}
                      </p>
                    )}
                  </CheckoutGlassField>
                </div>
              </>
            )}

            {/* ── PIX ── */}
            {paymentMethod === 'pix' && !pixData && (
              <div className="rounded-lg border border-white/10 bg-black/25 px-4 py-3">
                <p className="text-sm text-zinc-300">
                  Para continuar com o pagamento via Pix, clique em{' '}
                  <strong className="text-white">Finalizar Pagamento</strong>{' '}
                  abaixo. O código copia e cola será gerado automaticamente.
                </p>
              </div>
            )}

            {/* ── QR Code PIX gerado ── */}
            {pixData && paymentMethod === 'pix' && (
              <div className="flex flex-col items-center gap-4 py-2">
                <p className="text-center text-sm font-semibold text-zinc-100">
                  PIX gerado com sucesso!
                </p>
                {(pixData.pix_qrcode || pixData.pix_qrcode_url) && (
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-xs text-zinc-400">
                      Escaneie o QR Code com seu app de pagamentos
                    </p>
                    <div className="rounded-xl border border-white/15 bg-white p-3 shadow-lg shadow-black/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={pixData.pix_qrcode || pixData.pix_qrcode_url}
                        alt="QR Code PIX"
                        className="h-44 w-44 object-contain"
                      />
                    </div>
                    <p className="text-xs text-zinc-500">
                      ou use o código Copia e Cola abaixo
                    </p>
                  </div>
                )}
                {pixData.qr_code &&
                  !pixData.pix_qrcode &&
                  !pixData.pix_qrcode_url && (
                    <div className="flex flex-col items-center gap-1">
                      <div className="rounded-xl border border-white/15 bg-white p-3 shadow-lg shadow-black/40">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://chart.googleapis.com/chart?chs=300x300&cht=qr&chl=${encodeURIComponent(pixData.qr_code)}`}
                          alt="QR Code PIX"
                          className="h-44 w-44 object-contain"
                        />
                      </div>
                    </div>
                  )}
                {(() => {
                  const pixCopiaCola =
                    pixData.pix_content ||
                    pixData.pix_copy_paste ||
                    pixData.pix_copia_cola ||
                    pixData.copia_cola ||
                    pixData.copypaste ||
                    pixData.copy_paste;
                  if (!pixCopiaCola) return null;
                  return (
                    <>
                      <div className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
                        <p
                          className="select-all break-all text-xs text-zinc-300"
                          id="pix-copia-cola"
                        >
                          {pixCopiaCola}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault();
                          try {
                            await navigator.clipboard.writeText(pixCopiaCola);
                          } catch {
                            const el =
                              document.getElementById('pix-copia-cola');
                            if (el) {
                              const range = document.createRange();
                              range.selectNodeContents(el);
                              const sel = window.getSelection();
                              if (sel) {
                                sel.removeAllRanges();
                                sel.addRange(range);
                                document.execCommand('copy');
                                sel.removeAllRanges();
                              }
                            }
                          }
                          setCopiedPix(true);
                          setTimeout(() => setCopiedPix(false), 1500);
                        }}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[rgba(246,182,122,.35)] bg-[rgba(245,138,42,.12)] px-4 py-2.5 text-sm font-semibold text-[#d9d4e3] transition hover:bg-[rgba(245,138,42,.2)]"
                      >
                        <Copy className="h-4 w-4" />
                        {copiedPix ? 'Copiado!' : 'Copiar código PIX'}
                      </button>
                    </>
                  );
                })()}
                {pixData.expires_in && (
                  <p className="text-center text-xs text-zinc-500">
                    QR Code expira em {pixData.expires_in} minutos
                  </p>
                )}
                <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-400/20 bg-blue-500/10 px-4 py-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                  <span className="text-sm font-medium text-blue-200">
                    Verificando pagamento…
                  </span>
                </div>
                <p className="text-center text-xs text-zinc-500">
                  Após o pagamento, aguarde a confirmação automática.
                </p>
              </div>
            )}
          </div>
        }
      />

      {/* Modal de E-mail */}
      <EmailNoticeModal
        open={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        isPagatgHost={isPagatgHost}
      />
    </>
  );
};

export default CheckoutForm;
