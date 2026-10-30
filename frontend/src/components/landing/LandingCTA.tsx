import Link from 'next/link';

import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { MarketingManagementLottie } from '@/components/landing/MarketingManagementLottie';

export function LandingCTA() {
  return (
    <section
      id="ajuda"
      className="w-full bg-[#070712] px-6 py-24 lg:px-20 md:py-32 relative"
    >
      <div className="max-w-[1280px] mx-auto">
        <div className="relative overflow-hidden rounded-[3rem] border border-white/10 bg-gradient-to-br from-violet-600/20 to-violet-900/20 p-12 md:p-20 backdrop-blur-xl">
          {/* background glows */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-violet-500/10 blur-[100px] -translate-y-1/2 translate-x-1/2" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-600/10 blur-[80px] translate-y-1/2 -translate-x-1/2" />

          <div className="relative z-10 grid gap-12 md:grid-cols-[1fr_400px] md:items-center">
            <div>
              <span className="inline-block px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[12px] font-bold text-white uppercase tracking-widest mb-6">
                Pronto para começar?
              </span>
              <h3 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-6 leading-[1.1]">
                Pronto para receber pagamentos com mais previsibilidade?
              </h3>
              <p className="text-xl leading-relaxed text-white/60 mb-10 max-w-xl">
                Abra sua conta agora e comece a escalar seu faturamento com
                links, checkout e recorrência de forma simplificada.
              </p>

              <div className="flex flex-col gap-4 sm:flex-row">
                <Link
                  href="/cadastro"
                  className="inline-flex h-14 items-center justify-center gap-3 rounded-2xl bg-white px-10 text-[16px] font-bold text-[#6d28d9] shadow-[0_8px_30px_rgba(0,0,0,0.2)] transition-all duration-200 hover:bg-[#f5f3ff] hover:-translate-y-1 active:scale-[0.98]"
                >
                  Criar conta grátis
                </Link>
                <Link
                  href="/login"
                  className="inline-flex h-14 items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-10 text-[16px] font-bold text-white backdrop-blur-md transition-all duration-200 hover:bg-white/10 active:scale-[0.98]"
                >
                  Falar com especialista
                </Link>
              </div>
            </div>

            {/* Lottie à direita (sem fundo/borda) */}
            <div className="hidden md:block">
              <div className="w-full max-w-[400px] mx-auto scale-110">
                <MarketingManagementLottie />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
