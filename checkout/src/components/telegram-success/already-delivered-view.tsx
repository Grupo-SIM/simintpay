'use client';

import { Check, Package, Home, ArrowRight, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { StatusHeader } from './status-header';
import { DetailsCard } from './details-card';
import type { PurchaseDetails } from './types';

interface AlreadyDeliveredViewProps {
  email: string | null;
  purchaseDetails: PurchaseDetails | null;
  showRegenerateForm: boolean;
  regenerateLoading: boolean;
  regenerateError: string;
  onShowRegenerateForm: () => void;
  onCancelRegenerateForm: () => void;
  onSubmitRegenerateForm: (e: React.FormEvent) => void;
}

export function AlreadyDeliveredView({
  email,
  purchaseDetails,
  showRegenerateForm,
  regenerateLoading,
  regenerateError,
  onShowRegenerateForm,
  onCancelRegenerateForm,
  onSubmitRegenerateForm,
}: AlreadyDeliveredViewProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl space-y-4">
        <StatusHeader
          gradientClass="bg-gradient-to-r from-teal-500 via-teal-600 to-cyan-700"
          icon={<Package className="w-6 h-6 text-white" />}
          title="Detalhes do Pedido"
          subtitle="Link de acesso já entregue anteriormente"
          badge={
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-500 text-white text-sm font-medium">
              <Check className="w-4 h-4" />
              Ativa
            </span>
          }
        />

        <DetailsCard email={email} purchaseDetails={purchaseDetails} />

        <div className="rounded-xl border-2 border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white p-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="text-2xl">🚀</span>
              <h2 className="text-xl font-semibold text-gray-900">
                Próximos Passos
              </h2>
            </div>
            <p className="text-gray-500 text-sm mb-6">
              Você já recebeu seu link de acesso anteriormente. Se saiu do
              grupo, solicite um novo link abaixo.
            </p>

            {!showRegenerateForm ? (
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => router.push('/')}
                  className="inline-flex items-center gap-2 border border-gray-300 text-gray-700 hover:bg-gray-50 py-3 px-6 rounded-xl text-sm font-medium transition"
                >
                  <Home className="w-4 h-4" />
                  Voltar ao Início
                </button>
                <button
                  onClick={onShowRegenerateForm}
                  className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3 px-6 rounded-xl text-sm font-medium transition"
                >
                  Solicitar novo link
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <form
                onSubmit={onSubmitRegenerateForm}
                className="max-w-sm mx-auto text-left"
              >
                <p className="text-sm text-gray-600 mb-3">
                  Confirme seu e-mail para receber um novo link de acesso ao
                  grupo.
                </p>
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    E-mail
                  </label>
                  <input
                    type="email"
                    value={email ?? ''}
                    readOnly
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                  />
                </div>
                {regenerateError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                    <p className="text-sm text-red-700">{regenerateError}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onCancelRegenerateForm}
                    className="flex-1 py-2.5 px-4 rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={regenerateLoading}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-semibold py-2.5 px-4 rounded-xl text-sm transition"
                  >
                    {regenerateLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Gerando...
                      </>
                    ) : (
                      'Gerar novo link'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
