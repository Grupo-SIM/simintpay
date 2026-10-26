'use client';

import { XCircle, Home, Send, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { StatusHeader } from './status-header';

interface ErrorViewProps {
  errorMessage: string;
}

export function ErrorView({ errorMessage }: ErrorViewProps) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl space-y-4">
        <StatusHeader
          gradientClass="bg-gradient-to-r from-red-500 to-rose-600"
          icon={<XCircle className="w-6 h-6 text-white" />}
          title="Erro inesperado"
          subtitle="Ocorreu um problema ao processar seu acesso"
        />

        <div className="rounded-xl border-2 border-red-200 bg-gradient-to-b from-red-50/50 to-white p-8 text-center">
          <p className="text-gray-600 text-sm mb-4">
            Entre em contato com nosso suporte informando seu e-mail e o código
            do plano.
          </p>
          {process.env.NODE_ENV === 'development' && errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-left max-w-md mx-auto">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 font-mono break-all">
                  {errorMessage}
                </p>
              </div>
            </div>
          )}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center gap-2 border border-gray-300 text-gray-700 hover:bg-gray-50 py-3 px-6 rounded-xl text-sm font-medium transition"
            >
              <Home className="w-4 h-4" />
              Voltar ao Início
            </button>
            <a
              href="mailto:contatosimintermediacoes@gmail.com"
              className="inline-flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white py-3 px-6 rounded-xl text-sm font-medium transition"
            >
              <Send className="w-4 h-4" />
              Contatar Suporte
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
