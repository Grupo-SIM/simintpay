'use client';

import { Check, Package, Home, ArrowRight, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { StatusHeader } from './status-header';
import { DetailsCard } from './details-card';
import type { InviteLinkData, PurchaseDetails } from './types';

interface SuccessViewProps {
  inviteData: InviteLinkData | null;
  email: string | null;
  isRegenerated: boolean;
  purchaseDetails: PurchaseDetails | null;
}

export function SuccessView({
  inviteData,
  email,
  isRegenerated,
  purchaseDetails,
}: SuccessViewProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl space-y-4">
        <StatusHeader
          gradientClass="bg-gradient-to-r from-teal-500 via-teal-600 to-cyan-700"
          icon={<Package className="w-6 h-6 text-white" />}
          title="Detalhes do Pedido"
          subtitle={isRegenerated ? 'Novo link gerado com sucesso' : undefined}
          badge={
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500 text-white text-sm font-medium">
              <Check className="w-4 h-4" />
              Ativa
            </span>
          }
        />

        <DetailsCard
          email={email}
          groupName={inviteData?.groupName}
          purchaseDetails={purchaseDetails}
        />

        <div className="rounded-xl border-2 border-emerald-200 bg-gradient-to-b from-emerald-50/80 to-white p-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className="text-2xl">🚀</span>
              <h2 className="text-xl font-semibold text-gray-900">
                Próximos Passos
              </h2>
            </div>
            <p className="text-gray-500 text-sm mb-6">
              Sua assinatura está ativa! Clique no botão abaixo para acessar o
              seu conteúdo.
            </p>

            <div className="flex items-center justify-center gap-3 mb-6">
              <a
                href={inviteData?.inviteLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3 px-6 rounded-xl text-sm font-medium transition"
              >
                Acessar Agora
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-left max-w-md mx-auto">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  <span className="font-semibold">Link de uso único</span> Use-o
                  apenas quando estiver pronto para entrar no grupo. Após o
                  primeiro acesso, o link será invalidado automaticamente.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
