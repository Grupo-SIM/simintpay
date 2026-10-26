import { Star, CreditCard, Mail, Calendar } from 'lucide-react';
import type { PurchaseDetails } from './types';
import { usePixPlanSuffix } from '@/hooks/usePixPlanSuffix';

interface DetailsCardProps {
  email: string | null;
  groupName?: string;
  purchaseDetails?: PurchaseDetails | null;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value / 100);
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function DetailsCard({
  email,
  groupName,
  purchaseDetails,
}: DetailsCardProps) {
  const { removePixSuffix } = usePixPlanSuffix();
  const displayEmail = purchaseDetails?.customerEmail ?? email;
  const isActive = purchaseDetails?.isActive !== false;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8">
      <div className="grid md:grid-cols-2 gap-8">
        <div>
          <div className="flex items-center gap-2 mb-6">
            <Star className="w-5 h-5 text-amber-400" />
            <h2 className="text-base font-semibold text-gray-900">
              Informações do Plano
            </h2>
          </div>
          <div className="space-y-5">
            {groupName !== undefined && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Nome do Grupo</span>
                <span className="text-gray-900 font-medium text-sm">
                  {groupName || '—'}
                </span>
              </div>
            )}
            {purchaseDetails?.planName && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Nome do Plano</span>
                <span className="text-gray-900 font-medium text-sm">
                  {removePixSuffix(purchaseDetails.planName)}
                </span>
              </div>
            )}
            {purchaseDetails?.planValue != null && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Valor</span>
                <div className="text-right">
                  <span className="text-emerald-600 font-semibold text-sm">
                    {formatCurrency(purchaseDetails.planValue)}
                  </span>
                  {purchaseDetails.planFrequency && (
                    <p className="text-xs text-gray-400">
                      por {purchaseDetails.planFrequency}
                    </p>
                  )}
                  {purchaseDetails.planDays && (
                    <p className="text-xs text-gray-400">
                      {purchaseDetails.planDays} dias
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-sm">Status</span>
              <span
                className={`inline-flex px-3 py-1 rounded-md text-sm font-medium border ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                    : 'bg-gray-100 text-gray-600 border-gray-200'
                }`}
              >
                {isActive ? 'Ativa' : 'Inativa'}
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-6">
            <CreditCard className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-semibold text-gray-900">
              Informações de Acesso
            </h2>
          </div>
          <div className="space-y-5">
            {purchaseDetails?.paymentMethod && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">
                  Método de Pagamento
                </span>
                <div className="flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-900 text-sm">
                    {purchaseDetails.paymentMethod}
                  </span>
                </div>
              </div>
            )}
            {purchaseDetails?.purchaseDate && (
              <div className="flex justify-between items-center">
                <span className="text-gray-500 text-sm">Data da Compra</span>
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-900 text-sm">
                    {formatDate(purchaseDetails.purchaseDate)}
                  </span>
                </div>
              </div>
            )}
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-500 text-sm whitespace-nowrap">
                E-mail do Cliente
              </span>
              <div className="flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-gray-900 text-sm break-all">
                  {displayEmail ?? '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
