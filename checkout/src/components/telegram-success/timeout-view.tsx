'use client';

import { Clock, Home, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { StatusHeader } from './status-header';

interface TimeoutViewProps {
  onRetry: () => void;
}

export function TimeoutView({ onRetry }: TimeoutViewProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl space-y-4">
        <StatusHeader
          gradientClass="bg-gradient-to-r from-amber-500 to-orange-500"
          icon={<Clock className="w-6 h-6 text-white" />}
          title="Pagamento em processamento"
          subtitle="Seu pagamento pode levar alguns minutos para ser confirmado"
        />

        <div className="rounded-xl border-2 border-amber-200 bg-gradient-to-b from-amber-50/80 to-white p-8 text-center">
          <p className="text-gray-600 text-sm mb-6">
            Não conseguimos confirmar seu pagamento neste momento. Tente
            novamente em instantes ou entre em contato com o suporte.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center gap-2 border border-gray-300 text-gray-700 hover:bg-gray-50 py-3 px-6 rounded-xl text-sm font-medium transition"
            >
              <Home className="w-4 h-4" />
              Voltar ao Início
            </button>
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white py-3 px-6 rounded-xl text-sm font-medium transition"
            >
              <RefreshCw className="w-4 h-4" />
              Verificar novamente
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-6">
            Suporte:{' '}
            <a
              href="mailto:contatosimintermediacoes@gmail.com"
              className="text-blue-500 hover:underline"
            >
              contatosimintermediacoes@gmail.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
