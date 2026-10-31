import Link from 'next/link';
import { ArrowRight, CreditCard, Link2, Repeat } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { cn } from '@/lib/utils';

const STEPS = [
  {
    title: 'Links de pagamento',
    description:
      'Crie cobranças em segundos e compartilhe com seus clientes em qualquer canal.',
    icon: Link2,
  },
  {
    title: 'Pagamentos com cartão',
    description:
      'Checkout moderno e preparado para converter com estabilidade e segurança.',
    icon: CreditCard,
  },
  {
    title: 'Assinaturas',
    description:
      'Recorrência simples e previsível para o seu negócio crescer todo mês.',
    icon: Repeat,
  },
];

export function LandingHowItWorks() {
  return (
    <section
      id="sobre"
      className="w-full bg-[#070712] px-6 py-24 lg:px-20 md:py-32 relative overflow-hidden"
    >
      {/* background glow */}
      <div className="absolute top-1/4 -right-24 w-96 h-96 bg-violet-600/10 blur-[100px] pointer-events-none" />

      <div className="max-w-[1280px] mx-auto grid grid-cols-1 gap-16 md:grid-cols-2 md:items-center relative z-10">
        <div className="max-w-xl">
          <span className="inline-block px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-[13px] font-semibold text-violet-300 uppercase tracking-wider mb-6">
            Como funciona?
          </span>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-[1.15] mb-6">
            Receba de seus clientes de forma{' '}
            <span className="text-violet-400">rápida e segura</span>
          </h2>
          <p className="text-lg leading-relaxed text-white/60 mb-10">
            Uma plataforma pensada para você operar pagamentos com clareza: do
            link à conciliação. Evolua sua operação e entregue uma experiência
            melhor.
          </p>

          <div>
            <Link
              href="/login"
              className="inline-flex h-14 items-center justify-center gap-3 rounded-xl bg-white px-10 text-[16px] font-bold text-[#6d28d9] shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition-all duration-200 hover:bg-[#f5f3ff] hover:-translate-y-1 active:scale-[0.98]"
            >
              Começar agora
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600/10 transition-colors">
                <ArrowRight className="h-4 w-4" />
              </div>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className="group relative rounded-3xl border border-white/[0.06] bg-white/[0.02] p-8 backdrop-blur-md transition-all duration-300 hover:border-violet-500/30 hover:bg-white/[0.05] hover:translate-x-2"
            >
              <div className="flex items-start gap-6">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600/20 to-violet-900/40 text-violet-300 border border-violet-500/20 transition-transform duration-500 group-hover:scale-110">
                  <s.icon className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-white mb-2">
                    {s.title}
                  </h3>
                  <p className="text-base leading-relaxed text-white/50">
                    {s.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
