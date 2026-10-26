import { Lock, ShieldCheck } from 'lucide-react';

/** Selos de confiança + "Processado por Simintpay" (rodapé do resumo desktop). */
export function TrustFooter() {
  return (
    <>
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5 text-[13px] text-[#a9a3b8]">
          <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={2} />
          Conexão criptografada de ponta a ponta
        </div>
        <div className="flex items-center gap-2.5 text-[13px] text-[#a9a3b8]">
          <Lock className="h-4 w-4 shrink-0" strokeWidth={2} />
          Dados tratados conforme a LGPD
        </div>
      </div>
      <div className="border-t border-white/[0.08] pt-3.5 text-center text-xs text-[#7d778b]">
        Processado por{' '}
        <span className="font-medium text-[#d9d4e3]">Simintpay</span>
      </div>
    </>
  );
}
