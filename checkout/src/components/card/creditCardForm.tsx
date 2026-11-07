'use client';

import { Dropdown } from '@/components/ui/Dropdown';
import { EBOOK_API_URL, PAGATG_API_URL, SIM_API_URL } from '@/lib/api-config';

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
  CheckoutErrorScreen,
  CheckoutLoadingScreen,
} from '@/components/checkout/CheckoutStateScreens';
import { SummaryRow } from '@/components/checkout/ui';
import {
  CheckoutGlassField,
  CheckoutGlassInput,
} from '@/components/checkout/CheckoutFormPrimitives';
import { CheckoutCardPreview } from '@/components/checkout/CheckoutLayout';
import { CheckoutStatusCard } from '@/components/checkout/CheckoutStatusCard';
import { sanitizeCheckoutText } from '@/lib/text-utils';
import { buildInstallmentLabel } from '@/lib/installment-label';
import { checkoutTracking } from '@/lib/payment-tracking';

const SIMPAY_API_BASE_URL = SIM_API_URL;
const BACK_EBOOK_API_BASE_URL = EBOOK_API_URL;

const CheckoutForm = () => {
  const { removePixSuffix } = usePixPlanSuffix();
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const linkCode = searchParams.get('linkCode'); // Código do link avulso
  const subscriptionCode = searchParams.get('subscriptionCode'); // Código do link de assinatura recorrente

  const valueParam = searchParams.get('value');
  const descriptionParam = searchParams.get('description');
  const orderNumber = searchParams.get('orderNumber');
  const settlementId = searchParams.get('settlementId');
  const settlementToken = searchParams.get('settlementToken');
  const storeParam = searchParams.get('store');
  const orderIdFromQuery =
    searchParams.get('orderId') || searchParams.get('id');
  const dataParam = searchParams.get('data'); // Dados criptografados do payment link
  const maxInstallmentsParam = searchParams.get('maxInstallments');
  const normalizedStore = String(storeParam || '').toLowerCase();
  const isEbookCheckout =
    normalizedStore === 'ebook' || normalizedStore === 'ebooksim';
  const isPagatgHost =
    typeof window !== 'undefined' &&
    (window.location.hostname.includes('pagatg') ||
      window.location.hostname.includes('jbmidia') ||
      window.location.hostname.includes('localhost'));
  const isPagatgPlan = normalizedStore === 'pagatg' || isPagatgHost;

  console.log(
    '🔍 [URL PARAMS] code:',
    code,
    'linkCode:',
    linkCode,
    'valueParam:',
    valueParam,
    'dataParam:',
    dataParam,
    'descriptionParam:',
    descriptionParam,
    'orderNumber:',
    orderNumber,
  );

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

  const [planData, setPlanData] = useState<any>(null);
  const [paymentLinkData, setPaymentLinkData] = useState<any>(null); // Dados do link avulso
  const [subscriptionLinkData, setSubscriptionLinkData] = useState<any>(null); // Dados do link de assinatura recorrente
  const [paymentLinkFees, setPaymentLinkFees] = useState<any>(null); // Taxas calculadas com juros
  const [allInstallmentOptions, setAllInstallmentOptions] = useState<any[]>([]); // Todas as opções de parcelas com juros
  const [ebookInstallmentOptions, setEbookInstallmentOptions] = useState<any[]>(
    [],
  ); // Opções de parcelas para ebook (MDR_CC_MASTER)
  const [mounted, setMounted] = useState(false);

  const [cardFocused, setCardFocused] = useState<
    'number' | 'expiry' | 'cvc' | 'name' | ''
  >('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [planError, setPlanError] = useState('');
  const [formErrors, setFormErrors] = useState<any>({});
  const orderId = searchParams.get('id');
  const [orderData, setOrderData] = useState<any>(null);

  // ESTADO: adicionar método de pagamento, valor e descrição para pagamento único
  const [paymentMethod, setPaymentMethod] = useState('pix'); // "credit" ou "pix"
  const [singlePayment, setSinglePayment] = useState(false); // true se não houver plano
  const [singleValue, setSingleValue] = useState(0);
  const [singleDescription, setSingleDescription] = useState('');
  const [pixData, setPixData] = useState<any>(null); // dados do PIX (qr code, etc)
  const [copiedPix, setCopiedPix] = useState(false);
  const [pixPaymentId, setPixPaymentId] = useState<string>(''); // ID do pagamento PIX
  const [pixStatus, setPixStatus] = useState<string>('pending'); // status do pagamento PIX
  const [customFees, setCustomFees] = useState<any>(null); // taxas customizadas

  // Estados para o sistema de voucher
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherStatus, setVoucherStatus] = useState<any>(null);
  const [validatingVoucher, setValidatingVoucher] = useState(false);

  // Estado para controlar o modal de e-mail
  const [showEmailModal, setShowEmailModal] = useState(false);

  // Detecta plano pagatg pelos dados após carregar — credit_card only, não ebook
  const isPagatgPlanData =
    !isEbookCheckout &&
    !!planData &&
    Array.isArray(planData?.plan?.paymentMethods) &&
    planData.plan.paymentMethods.length === 1 &&
    planData.plan.paymentMethods[0]?.toLowerCase() === 'credit_card';

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

  // Detectar se é pagamento único (sem plano)
  useEffect(() => {
    if (!planData) {
      setSinglePayment(true);
      if (valueParam) setSingleValue(Number(valueParam));
      if (descriptionParam) setSingleDescription(descriptionParam);
    } else {
      setSinglePayment(false);
    }
  }, [planData, valueParam, descriptionParam]);

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

  // Buscar valor com taxa para planos pagatg (1x, MDR_CC_MASTER_1X do tenant PAGATG)
  useEffect(() => {
    if (!(isPagatgPlan || isPagatgPlanData) || !planData?.plan?.value) return;
    const price = Number(planData.plan.value);
    if (!price || price <= 0) return;

    const fetchPagatgRate = async () => {
      try {
        const resp = await fetch(
          `${SIMPAY_API_BASE_URL}/checkout/card/installment-options`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              price,
              store: 'pagatg',
              maxInstallments: 1,
            }),
          },
        );
        if (!resp.ok) return;
        const data = await resp.json();
        if (Array.isArray(data?.options) && data.options.length > 0) {
          setEbookInstallmentOptions(data.options);
        }
      } catch {
        // Silencioso
      }
    };
    fetchPagatgRate();
  }, [isPagatgPlan, isPagatgPlanData, planData]);

  // Mostrar modal de e-mail automaticamente após carregar
  // NÃO mostrar para payment links nem subscription links
  useEffect(() => {
    if (!fetching && !planError && !paymentLinkData && !subscriptionLinkData) {
      // Verificar se o modal já foi mostrado antes
      const modalShown = localStorage.getItem('emailModalShown');

      if (!modalShown) {
        const timer = setTimeout(() => {
          setShowEmailModal(true);
        }, 1000);

        return () => clearTimeout(timer);
      }
    }
  }, [fetching, planError, paymentLinkData]);

  // Definir automaticamente o método de pagamento com base no plano
  // PIX tem prioridade sempre que disponível
  useEffect(() => {
    if (
      planData?.plan?.paymentMethods &&
      Array.isArray(planData.plan.paymentMethods)
    ) {
      const methods = planData.plan.paymentMethods.map((m: string) =>
        m.toLowerCase(),
      );
      if (methods.includes('pix')) {
        setPaymentMethod('pix');
      } else if (methods.includes('credit_card')) {
        setPaymentMethod('credit');
      }
    }
  }, [planData]);

  // Definir método de pagamento com base no subscription link
  useEffect(() => {
    if (!subscriptionLinkData) return;
    const pm =
      (subscriptionLinkData.paymentMethods as string | undefined) ?? 'BOTH';
    if (pm === 'CREDIT_CARD') {
      setPaymentMethod('credit');
    } else if (pm === 'PIX') {
      setPaymentMethod('pix');
    }
    // Se BOTH, PIX é default (já é o estado inicial)
  }, [subscriptionLinkData]);

  // Fetch subscription link (recorrente) quando subscriptionCode presente
  useEffect(() => {
    if (!subscriptionCode) return;
    const fetchSubscriptionLink = async () => {
      try {
        console.log(
          '🔄 [SUBSCRIPTION LINK] Carregando dados do link de assinatura:',
          subscriptionCode,
        );
        const response = await fetch(
          `${SIMPAY_API_BASE_URL}/subscription-links/public/${subscriptionCode}`,
        );
        if (!response.ok) {
          throw new Error(
            `Erro ao carregar link de assinatura: ${response.status}`,
          );
        }
        const data = await response.json();
        console.log('✅ [SUBSCRIPTION LINK] Dados carregados:', data);
        setSubscriptionLinkData(data);
      } catch (err: any) {
        console.error('❌ [SUBSCRIPTION LINK] Erro ao carregar:', err);
        setPlanError(err.message || 'Erro ao carregar link de assinatura');
      } finally {
        setFetching(false);
      }
    };
    fetchSubscriptionLink();
  }, [subscriptionCode]);

  // Fetch plan details OU token para pagamento único
  useEffect(() => {
    if (subscriptionCode) return; // já tratado acima
    const fetchPlanOrToken = async () => {
      // Prioridade 1: Se tem dataParam, decodifica e busca dados do link via ID + token
      if (dataParam) {
        try {
          // Decodifica o payload Base64
          console.log(
            '🔗 [PAYMENT LINK] Decodificando dados criptografados...',
          );
          const decodedPayload = JSON.parse(atob(dataParam));
          console.log(
            '🔗 [PAYMENT LINK] Payload decodificado:',
            decodedPayload,
          );

          const { id, token } = decodedPayload;

          console.log('🔗 [PAYMENT LINK] Carregando dados do link via ID:', id);
          const response = await fetch(
            `${SIMPAY_API_BASE_URL}/links-pagamento/public/${id}`,
          );
          if (!response.ok) {
            throw new Error(
              `Erro ao carregar link de pagamento: ${response.status}`,
            );
          }
          const data = await response.json();
          console.log('✅ [PAYMENT LINK] Dados carregados:', data);
          setPaymentLinkData(data);
          setToken(token);
        } catch (err: any) {
          console.error('❌ [PAYMENT LINK] Erro ao carregar:', err);
          setPlanError(err.message || 'Erro ao carregar link de pagamento');
        } finally {
          setFetching(false);
        }
      } else if (linkCode) {
        try {
          console.log(
            '🔗 [PAYMENT LINK] Carregando dados do link via linkCode:',
            linkCode,
          );
          const response = await fetch(
            `${SIMPAY_API_BASE_URL}/links-pagamento/public/${linkCode}`,
          );
          if (!response.ok) {
            throw new Error(
              `Erro ao carregar link de pagamento: ${response.status}`,
            );
          }
          const data = await response.json();
          console.log('✅ [PAYMENT LINK] Dados carregados:', data);
          setPaymentLinkData(data);
        } catch (err: any) {
          console.error('❌ [PAYMENT LINK] Erro ao carregar:', err);
          setPlanError(err.message || 'Erro ao carregar link de pagamento');
        } finally {
          setFetching(false);
        }
      } else if (valueParam && !code && !orderNumber && !descriptionParam) {
        // Prioridade 2: Se tem APENAS value (sem code, orderNumber ou description), é um payment link
        // Formato do admin-master: ?value=RX8Fap8kbp
        try {
          console.log(
            '🔗 [PAYMENT LINK] Carregando dados do link via value (código):',
            valueParam,
          );
          const response = await fetch(
            `${SIMPAY_API_BASE_URL}/links-pagamento/public/${valueParam}`,
          );
          if (!response.ok) {
            throw new Error(
              `Erro ao carregar link de pagamento: ${response.status}`,
            );
          }
          const data = await response.json();
          console.log('✅ [PAYMENT LINK] Dados carregados:', data);
          setPaymentLinkData(data);
        } catch (err: any) {
          console.error('❌ [PAYMENT LINK] Erro ao carregar:', err);
          setPlanError(err.message || 'Erro ao carregar link de pagamento');
        } finally {
          setFetching(false);
        }
      } else if (valueParam && descriptionParam === 'link_avulso') {
        // Prioridade 3: Se tem value + description='link_avulso', busca dados do link via ID e token
        // Exemplo: ?value=69f74319-96b4-48f1-addd-fb9b31f8c2da&description=link_avulso&adminToken=xxx
        const adminToken = searchParams.get('adminToken');
        if (!adminToken) {
          setPlanError(
            'Token de autenticação obrigatório para links de pagamento',
          );
          setFetching(false);
          return;
        }
        try {
          console.log(
            '🔗 [PAYMENT LINK] Carregando dados do link via ID:',
            valueParam,
          );
          const response = await fetch(
            `${SIMPAY_API_BASE_URL}/links-pagamento/public/${valueParam}`,
          );
          if (!response.ok) {
            throw new Error(
              `Erro ao carregar link de pagamento: ${response.status}`,
            );
          }
          const data = await response.json();
          console.log('✅ [PAYMENT LINK] Dados carregados:', data);
          setPaymentLinkData(data);
          setToken(adminToken);
        } catch (err: any) {
          console.error('❌ [PAYMENT LINK] Erro ao carregar:', err);
          setPlanError(err.message || 'Erro ao carregar link de pagamento');
        } finally {
          setFetching(false);
        }
      } else if (code) {
        // Fluxo de plano
        try {
          const isPixPlanCode = /^PX-/.test(String(code));
          let url = `${SIMPAY_API_BASE_URL}/planos/public/by-code/${code}`;

          if (isPixPlanCode) {
            url = `${SIMPAY_API_BASE_URL}/payments/pix-plan/link-code-details/${code}/checkout`;
          }

          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(
              `Erro ao carregar detalhes do plano: ${response.status}`,
            );
          }
          const data = await response.json();
          setPlanData(data);
          if (data?.token) setToken(data.token);
        } catch (err: any) {
          setPlanError(err.message || 'Erro ao carregar detalhes do plano');
        } finally {
          setFetching(false);
        }
      } else {
        // Capturar adminToken da URL (sem fallback fixo)
        const adminToken = searchParams.get('adminToken');
        if (adminToken) setToken(adminToken);
        setFetching(false);
      }
    };
    fetchPlanOrToken();
  }, [code, linkCode, searchParams]);

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

  // Buscar taxas de juros quando o payment link é carregado
  useEffect(() => {
    const fetchAllInstallmentOptions = async () => {
      // Usar code ou id como identificador
      const linkIdentifier = paymentLinkData?.code || paymentLinkData?.id;

      if (
        paymentLinkData &&
        linkIdentifier &&
        paymentLinkData.maxInstallments
      ) {
        try {
          console.log(
            '💰 [PAYMENT LINK] Calculando todas as opções de parcelas para link:',
            linkIdentifier,
          );

          // Buscar taxas para TODAS as parcelas possíveis
          const promises = [];
          for (let i = 1; i <= paymentLinkData.maxInstallments; i++) {
            promises.push(
              fetch(
                `${SIMPAY_API_BASE_URL}/links-pagamento/public/${linkIdentifier}`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    code: linkIdentifier,
                    installments: i,
                  }),
                },
              ).then((res) => res.json()),
            );
          }

          const allOptions = await Promise.all(promises);
          console.log(
            '✅ [PAYMENT LINK] Todas as opções calculadas:',
            allOptions,
          );
          setAllInstallmentOptions(allOptions);

          // Define a taxa para a parcela atualmente selecionada
          const currentOption = allOptions.find(
            (opt) => opt.installments === formData.installments,
          );
          if (currentOption) {
            setPaymentLinkFees(currentOption);
          }
        } catch (err: any) {
          console.error('❌ [PAYMENT LINK] Erro ao calcular taxas:', err);
        }
      }
    };

    fetchAllInstallmentOptions();
  }, [paymentLinkData]);

  // Atualizar paymentLinkFees quando o número de parcelas muda
  useEffect(() => {
    if (allInstallmentOptions.length > 0) {
      const selectedOption = allInstallmentOptions.find(
        (opt) => opt.installments === formData.installments,
      );
      if (selectedOption) {
        console.log(
          '🔄 [PAYMENT LINK] Parcela alterada para:',
          formData.installments,
          'x - Juros:',
          selectedOption.interestRate,
          '%',
        );
        setPaymentLinkFees(selectedOption);
      }
    }
  }, [formData.installments, allInstallmentOptions]);

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
        price: getFinalValueWithDiscount(),
        ...(orderNumber ? { orderNumber } : {}),
        ...(settlementId ? { settlementId, settlementToken } : {}),
        ...(isPagatgHost &&
          voucherStatus?.valid && {
            voucherCode: voucherCode,
            finalAmount: getFinalValueWithDiscount(),
          }),
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

  // NOVA FUNÇÃO: handle para pagamento PIX de planos
  const handlePixPlanPayment = async () => {
    setLoading(true);
    setError('');
    setPixData(null);
    try {
      const isPixCode = /^PX-/.test(String(code || ''));

      if (isPixCode) {
        if (!token) {
          setError('Token do vendedor não recebido. Recarregue o link-code.');
          setLoading(false);
          return;
        }

        const body: any = {
          code: String(code),
          name: formData.name,
          email: formData.email,
          document_type:
            formData.document.replace(/\D/g, '').length <= 11 ? 'CPF' : 'CNPJ',
          document: formData.document.replace(/\D/g, ''),
          mobile_phone: formData.mobilePhone.replace(/\D/g, ''),
        };

        // Adicionar store se fornecido na URL
        if (storeParam) {
          body.store = storeParam;
          console.log('🏪 [CHECKOUT] Store parameter detected:', storeParam);
        }

        // Adicionar voucher se fornecido (backend validará)
        if (isPagatgHost && voucherCode && voucherCode.trim()) {
          body.voucherCode = voucherCode.trim().toUpperCase();
          // Se o voucher foi validado no frontend, usar o valor com desconto
          // Caso contrário, enviar null e deixar o backend calcular
          body.finalAmount = voucherStatus?.valid
            ? getFinalValueWithDiscount()
            : null;
          console.log('🎫 [CHECKOUT] Voucher enviado para backend:', {
            voucherCode: body.voucherCode,
            finalAmount: body.finalAmount,
            wasValidatedInFrontend: !!voucherStatus?.valid,
            originalPrice: planData?.plan?.value || 'N/A',
          });
        } else {
          console.log('⚠️ [CHECKOUT] Sem voucher:', {
            hostname:
              typeof window !== 'undefined' ? window.location.hostname : 'N/A',
            hasVoucherCode: !!voucherCode,
          });
        }

        console.log('📤 [CHECKOUT] Enviando PIX-PLAN para API:', {
          url: `${SIMPAY_API_BASE_URL}/payments/pix-plan/checkout-by-code`,
          body: JSON.stringify(body, null, 2),
        });

        const response = await fetch(
          `${SIMPAY_API_BASE_URL}/payments/pix-plan/checkout-by-code`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          },
        );
        const data = await response.json();

        if (!response.ok) {
          setError(data?.message || 'Erro ao criar pagamento PIX-PLAN');
          setLoading(false);
          return;
        }

        if (data.paymentId) setPixPaymentId(data.paymentId);
        else if (data.id) setPixPaymentId(data.id);
        setPixData(data);
        setLoading(false);
        return;
      }

      // Fluxo antigo: PIX para plano de cartão (não é code PX-)
      const storeFromContext =
        storeParam || (isPagatgHost ? 'pagatg' : undefined);
      const body = {
        description: `Assinatura: ${planData.plan.description}`,
        name: formData.name,
        email: formData.email,
        document_type:
          formData.document.replace(/\D/g, '').length <= 11 ? 'CPF' : 'CNPJ',
        document: formData.document.replace(/\D/g, ''),
        mobile_phone: formData.mobilePhone.replace(/\D/g, ''),
        price: getFinalValueWithDiscount(),
        linkCodePlanId: planData.id,
        ...(storeFromContext && { store: storeFromContext }),
        ...(isPagatgHost &&
          voucherStatus?.valid && {
            voucherCode: voucherCode,
            finalAmount: getFinalValueWithDiscount(),
          }),
      };

      if (planData?.planId) {
        (body as any).planId = planData.planId;
      }

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
        setError(data?.message || 'Erro ao criar pagamento PIX para plano');
        setLoading(false);
        return;
      }
      if (data.id) setPixPaymentId(data.id);
      setPixData(data);
      setLoading(false);
    } catch (err) {
      setError('Erro ao criar pagamento PIX. Tente novamente.');
      setLoading(false);
    }
  };

  // PIX para subscription links (areaflix etc.)
  const handleSubscriptionLinkPixPayment = async () => {
    setLoading(true);
    setError('');
    try {
      const body = {
        customerName: formData.name,
        customerEmail: formData.email,
        customerDocument: formData.document.replace(/\D/g, ''),
        customerPhone: formData.mobilePhone.replace(/\D/g, ''),
      };
      const response = await fetch(
        `${SIMPAY_API_BASE_URL}/subscription-links/public/${subscriptionLinkData.codigo}/pix`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        setError(data?.message || 'Erro ao criar PIX para assinatura');
        setLoading(false);
        return;
      }
      if (data.id) setPixPaymentId(data.id);
      setPixData(data);
      setLoading(false);
    } catch {
      setError('Erro ao criar pagamento PIX. Tente novamente.');
      setLoading(false);
    }
  };

  // MODIFICAR handleSubmit para suportar pagamento único, PIX e PAYMENT LINKS
  const handleSubmit = async () => {
    // PAGAMENTO PIX: não validar etapa 2 de cartão
    if (paymentMethod === 'pix') {
      if (subscriptionLinkData) {
        // PIX para subscription links (areaflix etc.)
        await handleSubscriptionLinkPixPayment();
        return;
      } else if (singlePayment) {
        await handlePixPayment();
        return;
      } else {
        // PIX para planos
        await handlePixPlanPayment();
        return;
      }
    }
    // Validação etapa 2 (apenas para cartão)
    const isValid = validateStep2();
    if (!isValid) return;
    setLoading(true);
    setError('');
    setPixData(null);

    // FLUXO ESPECÍFICO PARA SUBSCRIPTION LINKS (recorrente via cartão)
    if (subscriptionLinkData) {
      try {
        const public_key = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';
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

          const body = {
            code: subscriptionLinkData.codigo,
            customerEmail: formData.email,
            customerName: formData.name,
            customerDocument: formData.document.replace(/\D/g, ''),
            customerDocumentType:
              formData.document.replace(/\D/g, '').length <= 11
                ? 'CPF'
                : 'CNPJ',
            customerMobilePhone: formData.mobilePhone.replace(/\D/g, ''),
            card: {
              token: response.token,
              brand: response.brand,
              bin: response.bin,
              exp_month: formData.month,
              exp_year: formData.year,
              cvv: formData.cvv,
              holder_name: formData.holder_name,
              holder_document: formData.holder_document.replace(/\D/g, ''),
              number: formData.number,
            },
          };

          const checkoutResponse = await fetch(
            `${SIMPAY_API_BASE_URL}/subscription-links/public/${subscriptionLinkData.codigo}/assinar`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            },
          );
          const responseData = await checkoutResponse.json();
          if (!checkoutResponse.ok) {
            setError(responseData?.message ?? 'Erro ao processar assinatura');
            setLoading(false);
            return;
          }
          if (code) {
            localStorage.setItem('checkout_plan_code', code);
            localStorage.setItem('checkout_email', formData.email);
            localStorage.setItem(
              'checkout_plan_name',
              subscriptionLinkData?.nome || '',
            );
            localStorage.setItem(
              'checkout_plan_value',
              String(
                Math.round(
                  (subscriptionLinkData?.valorComJuros ??
                    subscriptionLinkData?.valor ??
                    0) * 100,
                ),
              ),
            );
            localStorage.setItem(
              'checkout_payment_method',
              'Cartão de Crédito',
            );
            localStorage.setItem(
              'checkout_purchase_date',
              new Date().toISOString(),
            );
          }
          if (responseData?.plan?.redirectUrl) {
            try {
              const redirectTarget = new URL(responseData.plan.redirectUrl);
              redirectTarget.searchParams.set('reference', responseData.id);
              redirectTarget.searchParams.set('email', formData.email);
              return window.location.replace(redirectTarget.toString());
            } catch {
              return window.location.replace(responseData.plan.redirectUrl);
            }
          }
          router.push(`/subscription/success?reference=${responseData.id}`);
        } else {
          setError(response.msgError || 'Erro ao processar pagamento');
        }
        setLoading(false);
      } catch (err) {
        setError('Erro ao processar assinatura. Tente novamente.');
        setLoading(false);
      }
      return;
    }

    // FLUXO ESPECÍFICO PARA PAYMENT LINKS (não afeta outros fluxos)
    // Pode ser acessado via linkCode (público) OU via paymentLinkData (autenticado com token)
    if ((linkCode || paymentLinkData) && paymentLinkData) {
      try {
        const public_key = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';
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

          // Montar body conforme PaymentLinkCheckoutDto
          // Se tem linkCode, usar ele; senão, usar o code do paymentLinkData
          const body = {
            code: linkCode || paymentLinkData.code,
            installments: formData.installments,
            holder_name: formData.holder_name,
            token: response.token,
            bin: response.bin,
            brand: response.brand,
            email: formData.email,
            document: formData.document.replace(/\D/g, ''),
            document_type:
              formData.document.replace(/\D/g, '').length <= 11
                ? 'CPF'
                : 'CNPJ',
            mobile_phone: formData.mobilePhone.replace(/\D/g, ''),
            name: formData.name,
          };

          const checkoutResponse = await fetch(
            `${SIMPAY_API_BASE_URL}/links-pagamento/public/${linkCode || paymentLinkData.code}/charge`,
            {
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
            },
          );
          const responseData = await checkoutResponse.json();
          if (!checkoutResponse.ok) {
            setError(responseData?.message ?? 'Erro ao processar pagamento');
            setLoading(false);
            return;
          }
          // Redirecionar para página de sucesso
          router.push(
            buildPaymentSuccessUrl(
              responseData.transactionId || responseData.id,
            ),
          );
        } else {
          setError(response.msgError || 'Erro ao processar pagamento');
        }
        setLoading(false);
      } catch (err) {
        setError('Erro ao processar pagamento. Tente novamente.');
        setLoading(false);
      }
      return; // IMPORTANTE: retornar aqui para não executar os fluxos abaixo
    }
    // PAGAMENTO ÚNICO - CARTÃO
    if (singlePayment) {
      try {
        const public_key = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';
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
            price: getFinalValueWithDiscount(),
            holder_name: formData.holder_name,
            token: response.token,
            bin: response.bin,
            brand: response.brand,
            installments: formData.installments,
            description: getOrderDescription(),
            email: formData.email,
            document: formData.document.replace(/\D/g, ''),
            document_type:
              formData.document.replace(/\D/g, '').length <= 11
                ? 'CPF'
                : 'CNPJ',
            mobile_phone: formData.mobilePhone.replace(/\D/g, ''),
            name: formData.name,
            store: storeParam,
            ...(orderNumber ? { orderNumber } : {}),
            ...(settlementId ? { settlementId, settlementToken } : {}),
            ...(isPagatgHost &&
              voucherStatus?.valid && {
                voucherCode: voucherCode,
                finalAmount: getFinalValueWithDiscount(),
              }),
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
      return;
    }
    // FLUXO ATUAL: PLANO + CARTÃO
    try {
      const public_key = 'pk_4ce776b5-0d68-4fbe-b1eb-be10c94ca4e6';
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
        const subscriptionData = {
          customerEmail: formData.email,
          customerName: formData.name,
          customerDocument: formData.document.replace(/\D/g, ''),
          customerPhone: formData.mobilePhone.replace(/\D/g, ''),
          card: {
            token: response.token,
            brand: response.brand,
            bin: response.bin,
            exp_month: formData.month,
            exp_year: formData.year,
            cvv: formData.cvv,
            holder_name: formData.holder_name,
            holder_document: formData.holder_document.replace(/\D/g, ''),
            number: formData.number,
          },
        };
        const planIdForApi = planData.planId;
        const subscriptionResponse = await fetch(
          `${SIMPAY_API_BASE_URL}/planos/public/${planIdForApi}/subscribe`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscriptionData),
          },
        );
        if (!subscriptionResponse.ok) {
          const s = await subscriptionResponse.json();
          setError(s?.message ?? 'Erro ao processar pagamento');
          setLoading(false);
          return;
        }
        const responseData = await subscriptionResponse.json();
        if (code) {
          localStorage.setItem('checkout_plan_code', code);
          localStorage.setItem('checkout_email', formData.email);
          localStorage.setItem(
            'checkout_plan_name',
            planData?.plan?.description || '',
          );
          localStorage.setItem(
            'checkout_plan_value',
            String(Math.round((planData?.plan?.value ?? 0) * 100)),
          );
          localStorage.setItem(
            'checkout_payment_method',
            paymentMethod === 'pix' ? 'PIX' : 'Cartão de Crédito',
          );
          localStorage.setItem(
            'checkout_purchase_date',
            new Date().toISOString(),
          );
        }
        if (responseData?.redirectUrl) {
          try {
            const redirectTarget = new URL(responseData.redirectUrl);
            redirectTarget.searchParams.set('reference', responseData.id);
            redirectTarget.searchParams.set('email', formData.email);
            return window.location.replace(redirectTarget.toString());
          } catch {
            return window.location.replace(responseData.redirectUrl);
          }
        }
        router.push(`/subscription/success?reference=${responseData.id}`);
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

  const getFrequencyText = (type: any, frequency: any) => {
    if (type === 'MONTH') {
      return frequency === 1 ? 'mensal' : `a cada ${frequency} meses`;
    } else if (type === 'YEAR') {
      return frequency === 1 ? 'anual' : `a cada ${frequency} anos`;
    } else if (type === 'WEEK') {
      return frequency === 1 ? 'semanal' : `a cada ${frequency} semanas`;
    } else {
      return `a cada ${frequency} ${type.toLowerCase()}(s)`;
    }
  };

  const getSubscriptionFrequencyLabel = (frequencyType: string): string => {
    const labels: Record<string, string> = {
      MONTHLY: 'Cobrança mensal',
      TRIMESTRAL: 'Cobrança trimestral',
      SEMESTRAL: 'Cobrança semestral',
      ANUAL: 'Cobrança anual',
    };
    return labels[frequencyType] ?? 'Cobrança recorrente';
  };

  // Descrição enviada ao gateway (inclui orderNumber para rastreamento DOM)
  const getOrderDescription = (): string => {
    if (subscriptionLinkData) {
      return (
        subscriptionLinkData.nome ||
        subscriptionLinkData.descricao ||
        'Assinatura recorrente'
      );
    }
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
    if (subscriptionLinkData)
      return (
        subscriptionLinkData.nome ||
        subscriptionLinkData.descricao ||
        'Assinatura recorrente'
      );
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
    // Prioridade 0: Subscription Link — api-machine já calcula valorComJuros
    if (subscriptionLinkData) {
      return (
        subscriptionLinkData.valorComJuros ?? subscriptionLinkData.valor ?? 0
      );
    }
    // Prioridade 1: Payment Link COM juros
    if (paymentLinkFees && paymentLinkFees.totalAmount) {
      return paymentLinkFees.totalAmount; // Valor com juros
    }

    // Fallback: Payment Link sem juros calculados ainda
    if (paymentLinkData && paymentLinkData.amount) {
      return paymentLinkData.amount;
    }

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

    // Plano pagatg com taxa carregada: retorna totalAmount do 1x com taxa aplicada
    if (
      (isPagatgPlan || isPagatgPlanData) &&
      planData?.plan?.value &&
      ebookInstallmentOptions.length > 0
    ) {
      const selectedInstallments = Number(formData.installments) || 1;
      const opt =
        ebookInstallmentOptions.find(
          (o: any) => o.installments === selectedInstallments,
        ) ?? ebookInstallmentOptions[0];
      return opt?.totalAmount ?? Number(planData.plan.value);
    }

    // Se for plano, usar valor do plano
    if (planData && planData.plan && planData.plan.value) {
      return planData.plan.value;
    }

    // Se for pagamento único via URL params
    if (singlePayment && singleValue > 0) {
      return singleValue;
    }

    // Fallback para valor via URL params
    if (valueParam) {
      return Number(valueParam);
    }

    return 0;
  };

  // Função para calcular o valor final com desconto do voucher
  const getFinalValueWithDiscount = () => {
    // Verificar se estamos no domínio correto e se há voucher válido
    if (isPagatgHost && voucherStatus?.valid) {
      // PRIORIDADE 1: Se temos um voucher válido com finalAmount da API, usar esse valor
      if (
        voucherStatus.finalAmount !== undefined &&
        voucherStatus.finalAmount !== null
      ) {
        return voucherStatus.finalAmount;
      }

      // PRIORIDADE 2: Calcular manualmente se finalAmount não estiver disponível
      if (
        voucherStatus.discount !== undefined &&
        voucherStatus.discount !== null
      ) {
        const baseValue = getDisplayValue();
        const calculatedFinal = Math.max(0, baseValue - voucherStatus.discount);
        return calculatedFinal;
      }
    }

    // Se não há voucher válido, retornar valor original
    return getDisplayValue();
  };

  // Função para validar o voucher
  const validateVoucher = async () => {
    if (!voucherCode.trim()) return;

    // Verificar se temos o código do plano disponível
    if (!code) {
      setVoucherStatus({
        valid: false,
        message:
          'Código do plano não disponível. Não é possível validar o voucher.',
      });
      return;
    }

    setValidatingVoucher(true);
    setVoucherStatus(null);

    try {
      // URL base da API-PAGATG (com fallback para URL padrão)
      const API_PAGATG_URL = PAGATG_API_URL;

      console.log('🎫 [VOUCHER] Validando voucher:', {
        linkCode: code,
        voucherCode: voucherCode.trim().toUpperCase(),
        amount: getDisplayValue(),
      });

      // Usar o novo endpoint público que não requer autenticação
      const response = await fetch(
        `${API_PAGATG_URL}/webhook/validate-voucher-by-plan`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            linkCode: code, // Código do plano (ex: PX-DRB9LX)
            voucherCode: voucherCode.trim().toUpperCase(),
            amount: getDisplayValue(),
          }),
        },
      );

      // Tentar parsear JSON, mas tratar erros de parsing
      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        // Se não conseguir parsear JSON, tratar como erro genérico
        setVoucherStatus({
          valid: false,
          message:
            response.status === 401
              ? 'Token de autenticação inválido. Tente novamente.'
              : 'Erro ao validar cupom. Tente novamente.',
        });
        return;
      }

      if (response.ok && data.valid) {
        setVoucherStatus({
          valid: true,
          discount: data.discountAmount,
          message: `Cupom válido! Desconto de ${formatCurrency(data.discountAmount)}`,
          voucherId: data.voucherId,
          discountType: data.discountType,
          discountValue: data.discountValue,
          finalAmount: data.finalAmount,
        });
      } else {
        // Tratamento de erros específicos
        let errorMessage = data.message || 'Cupom inválido ou expirado';

        if (data.code === 'VOUCHER_NOT_VALID_FOR_GROUP_PAGE') {
          errorMessage = 'Este voucher não é válido para este group-page';
        } else if (data.code === 'API_DOM_ERROR') {
          errorMessage =
            data.message || 'Erro na validação do voucher. Tente novamente.';
        } else if (response.status === 401) {
          errorMessage = 'Token de autenticação inválido. Tente novamente.';
        } else if (response.status === 500) {
          errorMessage =
            'Erro interno do servidor. Tente novamente mais tarde.';
        }

        setVoucherStatus({
          valid: false,
          message: errorMessage,
        });
      }
    } catch (error) {
      setVoucherStatus({
        valid: false,
        message: 'Erro ao validar cupom. Tente novamente.',
      });
    } finally {
      setValidatingVoucher(false);
    }
  };

  // SSE primário + polling de fallback para confirmação de pagamento PIX
  useEffect(() => {
    if (!pixPaymentId || pixStatus === 'completed') return;

    let done = false;

    const handleCompleted = () => {
      if (done) return;
      done = true;
      setPixStatus('completed');
      if (singlePayment) {
        router.push(buildPaymentSuccessUrl(pixPaymentId));
      } else {
        // Sempre gravar o método: a tela de sucesso usa esse valor para decidir
        // se deve retentar no HTTP 400 (só cartão precisa). Ausente = tratado
        // como cartão e custa ~30s de espera desnecessária num PIX já entregue.
        localStorage.setItem('checkout_payment_method', 'PIX');
        localStorage.setItem('checkout_email', formData.email);
        localStorage.setItem(
          'checkout_purchase_date',
          new Date().toISOString(),
        );
        if (code) {
          localStorage.setItem('checkout_plan_code', code);
          localStorage.setItem(
            'checkout_plan_name',
            subscriptionLinkData?.nome ||
              subscriptionLinkData?.descricao ||
              planData?.plan?.description ||
              '',
          );
          localStorage.setItem(
            'checkout_plan_value',
            String(
              Math.round(
                (subscriptionLinkData?.valorComJuros ??
                  subscriptionLinkData?.valor ??
                  planData?.plan?.value ??
                  0) * 100,
              ),
            ),
          );
        }
        router.push(`/subscription/success?reference=${pixPaymentId}`);
      }
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
  }, [
    pixPaymentId,
    pixStatus,
    router,
    singlePayment,
    code,
    formData.email,
    subscriptionLinkData,
    planData,
  ]);

  // Seletor de método de pagamento aparece para checkout.pagatg.com ou se não for plano
  // IMPORTANTE: Payment links NUNCA mostram seletor (só cartão)
  // Subscription links mostram seletor apenas se paymentMethods = BOTH
  const isPaymentLink =
    dataParam ||
    linkCode ||
    (valueParam && !code && !orderNumber && !descriptionParam) ||
    (valueParam && descriptionParam === 'link_avulso');
  const isSubscriptionLink = !!subscriptionCode;
  const subscriptionLinkHasBothMethods =
    isSubscriptionLink &&
    subscriptionLinkData &&
    ((subscriptionLinkData.paymentMethods as string | undefined) ?? 'BOTH') ===
      'BOTH';
  const showPaymentMethodSelector =
    !isPaymentLink &&
    (!isSubscriptionLink || subscriptionLinkHasBothMethods) &&
    (isPagatgHost || !code);

  // Determinar quais métodos de pagamento estão disponíveis
  const getAvailablePaymentMethods = () => {
    // Payment links: APENAS cartão de crédito
    if (isPaymentLink && paymentLinkData) {
      return { pix: false, credit: true };
    }
    // Subscription links: respeitar paymentMethods do link
    if (isSubscriptionLink && subscriptionLinkData) {
      const pm =
        (subscriptionLinkData.paymentMethods as string | undefined) ?? 'BOTH';
      return { pix: pm !== 'CREDIT_CARD', credit: pm !== 'PIX' };
    }
    if (isSubscriptionLink) {
      return { pix: false, credit: true };
    }

    if (
      planData?.plan?.paymentMethods &&
      Array.isArray(planData.plan.paymentMethods)
    ) {
      const methods = planData.plan.paymentMethods.map((m: string) =>
        m.toLowerCase(),
      );
      return {
        pix: methods.includes('pix'),
        credit: methods.includes('credit_card'),
      };
    }
    // Se não houver plano ou paymentMethods, permitir ambos
    return { pix: true, credit: true };
  };

  const availableMethods = getAvailablePaymentMethods();

  // Se é payment link/subscription link mas ainda não carregou os dados, mostrar loading
  const isPaymentLinkFlow =
    dataParam ||
    linkCode ||
    (valueParam && !code && !orderNumber && !descriptionParam) ||
    (valueParam && descriptionParam === 'link_avulso');
  if (
    (isPaymentLinkFlow && !paymentLinkData && !planError) ||
    (isSubscriptionLink && !subscriptionLinkData && !planError)
  ) {
    return <CheckoutLoadingScreen message="Buscando dados do pagamento…" />;
  }

  if (fetching) {
    return <CheckoutLoadingScreen message="Preparando o checkout…" />;
  }

  if (planError && !valueParam && !descriptionParam) {
    // Só mostra erro se não for pagamento único (ou seja, não veio valor/descrição na URL)
    return (
      <CheckoutErrorScreen
        title="Erro ao carregar o plano"
        message={planError}
      />
    );
  }

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
          title: sanitizeCheckoutText(
            removePixSuffix(
              subscriptionLinkData
                ? subscriptionLinkData.nome || subscriptionLinkData.descricao
                : paymentLinkData
                  ? paymentLinkData.description
                  : planData
                    ? planData.plan.description
                    : getDisplayTitle(),
            ),
          ),
          price: formatCurrency(getDisplayValue()),
          frequency: subscriptionLinkData
            ? getSubscriptionFrequencyLabel(
                subscriptionLinkData.frequencia ||
                  subscriptionLinkData.frequencyType,
              )
            : paymentLinkData
              ? 'Pagamento único via link'
              : planData
                ? getFrequencyText(
                    planData.plan.frequencyType,
                    planData.plan.frequency,
                  )
                : 'Pagamento único',
        }}
        total={formatCurrency(getFinalValueWithDiscount())}
        asideRows={
          <>
            {/* Voucher — apenas em checkout.pagatg.com */}
            {isPagatgHost && (
              <div className="mt-4 flex flex-col gap-2 text-left">
                <p className="text-xs font-medium text-zinc-300">
                  Cupom de desconto
                </p>
                <div className="flex gap-2">
                  <div className="flex flex-1 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/10 focus-within:border-[rgba(240,168,108,.7)] focus-within:ring-1 focus-within:ring-[rgba(240,168,108,.3)]">
                    <input
                      type="text"
                      placeholder="Digite seu cupom"
                      value={voucherCode}
                      onChange={(e) => {
                        setVoucherCode(e.target.value);
                        if (voucherStatus) setVoucherStatus(null);
                      }}
                      className="flex-1 bg-transparent px-3 py-2 text-sm text-zinc-50 outline-none placeholder:text-zinc-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={validateVoucher}
                    disabled={
                      !voucherCode.trim() || validatingVoucher || !token
                    }
                    className="rounded-lg border border-[rgba(246,182,122,.35)] bg-[rgba(245,138,42,.12)] px-3 py-2 text-xs font-semibold text-[#d9d4e3] transition hover:bg-[rgba(245,138,42,.2)] disabled:cursor-not-allowed disabled:opacity-50"
                    title={
                      !token ? 'Aguarde o carregamento para validar cupom' : ''
                    }
                  >
                    {validatingVoucher ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#f6b67a] border-t-transparent" />
                    ) : (
                      'Validar'
                    )}
                  </button>
                </div>
                {voucherStatus && (
                  <div
                    className={`rounded-lg border p-2 text-xs ${voucherStatus.valid ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200' : 'border-red-400/25 bg-red-500/10 text-red-200'}`}
                  >
                    {voucherStatus.valid ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1 font-medium">
                            <CheckCircle className="h-3 w-3" /> Cupom aplicado!
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setVoucherStatus(null);
                              setVoucherCode('');
                            }}
                            className="text-red-400 text-xs hover:text-red-300"
                          >
                            Remover
                          </button>
                        </div>
                        <span>
                          {voucherStatus.discountType === 'PERCENTAGE'
                            ? `${voucherStatus.discountValue}% de desconto`
                            : `${formatCurrency(voucherStatus.discount)} de desconto`}
                        </span>
                        <span className="text-emerald-300">
                          Valor final:{' '}
                          {formatCurrency(voucherStatus.finalAmount)}
                        </span>
                      </div>
                    ) : (
                      <span className="flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {voucherStatus.message}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
            {voucherStatus?.valid && (
              <SummaryRow
                label="Desconto aplicado"
                value={`-${formatCurrency(voucherStatus.discount)}`}
              />
            )}
            {/* Valor da parcela — payment link */}
            {paymentLinkFees && paymentLinkFees.installments > 1 && (
              <p className="mt-1 text-center text-xs text-[#a9a3b8]">
                {paymentLinkFees.installments}x de{' '}
                {formatCurrency(paymentLinkFees.installmentAmount)}
              </p>
            )}
            {paymentLinkFees &&
              paymentLinkFees.installments === 1 &&
              paymentLinkFees.interestRate === 0 && (
                <p className="mt-1 text-center text-xs text-emerald-400">
                  Pagamento único à vista
                </p>
              )}
            {/* Parcelamento para plano */}
            {planData && (
              <p className="mt-1 text-center text-xs text-[#a9a3b8]">
                Ou em 4x de {formatCurrency(getFinalValueWithDiscount() / 4)}
              </p>
            )}
          </>
        }
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
              {!paymentLinkData && !subscriptionLinkData && (
                <div className="mb-2 rounded-lg border border-[rgba(246,182,122,.35)] bg-[rgba(245,138,42,.12)] px-3 py-2">
                  <p className="text-xs text-[#d9d4e3]">
                    Use o <strong>mesmo e-mail</strong>{' '}
                    {isPagatgHost
                      ? 'vinculado à sua assinatura do canal/grupo.'
                      : 'que você utilizou para se cadastrar na plataforma.'}
                  </p>
                </div>
              )}
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
            {showPaymentMethodSelector &&
              (availableMethods.credit || availableMethods.pix) && (
                <div className="flex flex-wrap items-center gap-4 rounded-[20px] border border-white/[0.07] bg-white/[0.06] px-4 py-3">
                  {availableMethods.credit && (
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
                  )}
                  {availableMethods.pix && (
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
                  )}
                </div>
              )}

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

                {/* Parcelas — payment link */}
                {paymentLinkData && paymentLinkData.maxInstallments > 1 && (
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
                      options={Array.from(
                        { length: paymentLinkData.maxInstallments },
                        (_, i) => i + 1,
                      ).map((num) => {
                        const option = allInstallmentOptions.find(
                          (opt) => opt.installments === num,
                        );
                        // "(com juros)" só quando a opção tem juros de fato.
                        const label = option
                          ? buildInstallmentLabel({
                              installments: num,
                              perInstallment: option.installmentAmount,
                              total:
                                option.totalAmount ??
                                option.installmentAmount * num,
                              interestAmount: option.interestAmount,
                              formatCurrency,
                            })
                          : buildInstallmentLabel({
                              installments: num,
                              perInstallment: paymentLinkData.amount / num,
                              total: paymentLinkData.amount,
                              formatCurrency,
                            });
                        return { value: String(num), label };
                      })}
                    />
                  </CheckoutGlassField>
                )}

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
