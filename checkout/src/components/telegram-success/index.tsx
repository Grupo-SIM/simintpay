'use client';

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  fetchInviteLink,
  fetchPurchaseDetails,
  regenerateInviteLink,
  MAX_POLL_ATTEMPTS,
  pollDelayFor,
} from './api';
import type {
  PageState,
  InviteLinkData,
  ApiError,
  PurchaseDetails,
} from './types';
import { PollingView } from './polling-view';
import { SuccessView } from './success-view';
import { AlreadyDeliveredView } from './already-delivered-view';
import { TimeoutView } from './timeout-view';
import { ErrorView } from './error-view';

function buildPurchaseDetailsFromLocalStorage(): PurchaseDetails | null {
  const planName = localStorage.getItem('checkout_plan_name');
  const planValueStr = localStorage.getItem('checkout_plan_value');
  const paymentMethod = localStorage.getItem('checkout_payment_method');
  const customerEmail = localStorage.getItem('checkout_email');
  const purchaseDate =
    localStorage.getItem('checkout_purchase_date') || new Date().toISOString();

  if (!planName && !planValueStr && !customerEmail) return null;

  return {
    planName: planName || null,
    planValue: planValueStr ? Number(planValueStr) : null,
    planFrequency: null,
    planDays: null,
    isActive: true,
    paymentMethod: paymentMethod || 'Cartão de Crédito',
    purchaseDate,
    customerEmail: customerEmail || null,
  };
}

export function TelegramSuccessContent() {
  const searchParams = useSearchParams();
  const planCode =
    searchParams.get('planCode') ||
    (typeof window !== 'undefined'
      ? localStorage.getItem('checkout_plan_code')
      : null);
  const emailFromUrl = searchParams.get('email');
  const email =
    emailFromUrl ||
    (typeof window !== 'undefined'
      ? localStorage.getItem('checkout_email')
      : null);
  const customerId = searchParams.get('customerId');
  const reference = searchParams.get('reference');

  const [state, setState] = useState<PageState>('polling');
  const [inviteData, setInviteData] = useState<InviteLinkData | null>(null);
  const [purchaseDetails, setPurchaseDetails] =
    useState<PurchaseDetails | null>(null);
  const [resolvedGroupPageId, setResolvedGroupPageId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pollAttempt, setPollAttempt] = useState(0);

  const [showRegenerateForm, setShowRegenerateForm] = useState(false);
  const [regenerateLoading, setRegenerateLoading] = useState(false);
  const [regenerateError, setRegenerateError] = useState('');

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const runPolling = useCallback(
    async function poll() {
      if (!planCode || !email) {
        setState('error');
        setErrorMessage(
          'Parâmetros obrigatórios ausentes na URL (planCode e email).',
        );
        return;
      }

      const attempt = attemptRef.current;

      // Para cartão de crédito, o reference é o ID da assinatura na API-DOM.
      // Passamos como subscriptionId para o backend verificar nova assinatura quando linkUsed=true.
      const subscriptionId = reference;

      try {
        const data = await fetchInviteLink(
          planCode,
          email,
          customerId,
          subscriptionId,
        );
        stopPolling();
        setInviteData(data);
        setResolvedGroupPageId(data.groupPageId);
        setState('success');
      } catch (err: unknown) {
        const apiErr = err as ApiError;

        if (apiErr.status === 400) {
          // Para PIX, o webhook dispara ANTES do redirect, então linkUsed=true significa que o
          // link foi genuinamente usado. Paramos imediatamente sem esperar.
          // Para cartão de crédito, o checkout redireciona antes do webhook SIGNATURE-CREATED
          // chegar, causando race condition. Retentamos para dar tempo ao webhook resetar linkUsed.
          const paymentMethod =
            typeof window !== 'undefined'
              ? localStorage.getItem('checkout_payment_method')
              : null;
          // Só retenta quando sabemos que é cartão. Método ausente ou PIX para
          // imediatamente — retentar um PIX já entregue custa ~30s à toa.
          const isCreditCard =
            !!paymentMethod && paymentMethod.toLowerCase() !== 'pix';

          if (!isCreditCard || attempt + 1 >= MAX_POLL_ATTEMPTS) {
            stopPolling();
            setState('already_delivered');
            return;
          }
          attemptRef.current = attempt + 1;
          setPollAttempt(attempt + 1);
          pollingRef.current = setTimeout(poll, pollDelayFor(attempt));
          return;
        }

        if (apiErr.status === 404) {
          if (attempt + 1 >= MAX_POLL_ATTEMPTS) {
            stopPolling();
            setState('timeout');
            return;
          }
          attemptRef.current = attempt + 1;
          setPollAttempt(attempt + 1);
          pollingRef.current = setTimeout(poll, pollDelayFor(attempt));
          return;
        }

        stopPolling();
        setState('error');
        setErrorMessage(apiErr.message ?? 'Erro inesperado ao buscar o link.');
      }
    },
    [planCode, email, customerId, reference, stopPolling],
  );

  useEffect(() => {
    if (reference) {
      fetchPurchaseDetails(reference).then((details) => {
        if (details) {
          setPurchaseDetails(details);
        } else {
          const fallback = buildPurchaseDetailsFromLocalStorage();
          if (fallback) setPurchaseDetails(fallback);
        }
      });
    } else {
      const fallback = buildPurchaseDetailsFromLocalStorage();
      if (fallback) setPurchaseDetails(fallback);
    }
    runPolling();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetryPolling = () => {
    attemptRef.current = 0;
    setPollAttempt(0);
    setState('polling');
    runPolling();
  };

  const handleRegenerateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegenerateError('');

    if (!resolvedGroupPageId) {
      setRegenerateError(
        'ID do grupo não disponível. Entre em contato com o suporte.',
      );
      return;
    }
    if (!email) {
      setRegenerateError('E-mail não encontrado na URL.');
      return;
    }

    setRegenerateLoading(true);
    try {
      const data = await regenerateInviteLink(resolvedGroupPageId, email);
      setInviteData((prev) => ({
        inviteLink: data.inviteLink,
        groupName: prev?.groupName ?? 'Grupo',
        groupPageId: prev?.groupPageId ?? resolvedGroupPageId,
      }));
      setState('regenerated');
      setShowRegenerateForm(false);
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      setRegenerateError(
        apiErr.message ?? 'Não foi possível gerar um novo link.',
      );
    } finally {
      setRegenerateLoading(false);
    }
  };

  const viewMap: Record<PageState, React.ReactElement> = {
    polling: <PollingView pollAttempt={pollAttempt} />,
    success: (
      <SuccessView
        inviteData={inviteData}
        email={email}
        isRegenerated={false}
        purchaseDetails={purchaseDetails}
      />
    ),
    regenerated: (
      <SuccessView
        inviteData={inviteData}
        email={email}
        isRegenerated={true}
        purchaseDetails={purchaseDetails}
      />
    ),
    already_delivered: (
      <AlreadyDeliveredView
        email={email}
        purchaseDetails={purchaseDetails}
        showRegenerateForm={showRegenerateForm}
        regenerateLoading={regenerateLoading}
        regenerateError={regenerateError}
        onShowRegenerateForm={() => setShowRegenerateForm(true)}
        onCancelRegenerateForm={() => {
          setShowRegenerateForm(false);
          setRegenerateError('');
        }}
        onSubmitRegenerateForm={handleRegenerateLink}
      />
    ),
    timeout: <TimeoutView onRetry={handleRetryPolling} />,
    error: <ErrorView errorMessage={errorMessage} />,
  };

  return viewMap[state];
}
