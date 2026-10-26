import { RefreshCw } from 'lucide-react';
import { MAX_POLL_ATTEMPTS } from './api';

interface PollingViewProps {
  pollAttempt: number;
}

export function PollingView({ pollAttempt }: PollingViewProps) {
  const progressPercent = Math.round((pollAttempt / MAX_POLL_ATTEMPTS) * 100);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8 text-center">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <RefreshCw className="w-10 h-10 text-blue-600 animate-spin" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Confirmando seu pagamento...
        </h1>
        <p className="text-gray-500 mb-6">
          Aguarde enquanto verificamos sua compra e preparamos seu acesso ao
          grupo.
        </p>
        <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent || 5}%` }}
          />
        </div>
        <p className="text-xs text-gray-400">
          Verificação {pollAttempt + 1} de {MAX_POLL_ATTEMPTS}
        </p>
      </div>
    </div>
  );
}
