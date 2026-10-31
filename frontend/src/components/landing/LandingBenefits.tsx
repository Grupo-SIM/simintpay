import { DollarSign, ShieldCheck, Timer, Zap } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';

const BENEFITS = [
  {
    title: 'Melhores taxas do mercado',
    description: 'Estrutura pensada para maximizar sua margem e sua escala.',
    icon: DollarSign,
  },
  {
    title: 'Altíssima taxa de aprovação',
    description:
      'Rotas e inteligência para reduzir falhas e aumentar conversão.',
    icon: Zap,
  },
  {
    title: 'Dinheiro no prazo',
    description: 'Saques com previsibilidade e uma operação sem enrolação.',
    icon: Timer,
  },
  {
    title: 'Segurança de verdade',
    description: 'Boas práticas, antifraude e transparência em cada etapa.',
    icon: ShieldCheck,
  },
];

export function LandingBenefits() {
  return (
    <section
      id="beneficios"
      className="w-full bg-[#070712] relative overflow-hidden"
    >
      {/* top wave divider — transition from dark to purple gradient */}
      <div className="absolute top-0 left-0 w-full rotate-180 z-20">
        <svg
          viewBox="0 0 1440 120"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          className="w-full h-[60px] md:h-[100px]"
        >
          <path
            d="M0,60 C360,120 1080,0 1440,60 L1440,120 L0,120 Z"
            fill="#070712"
          />
        </svg>
      </div>

      {/* purple background area with gradient */}
      <div className="w-full bg-gradient-to-br from-[#7c3aed] via-[#6d28d9] to-[#4c1d95] px-6 py-32 lg:px-20 md:py-48 relative">
        {/* background dots for continuity */}
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.4) 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }}
        />

        <div className="max-w-[1280px] mx-auto relative z-10 text-center mb-16">
          <span className="inline-block px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[12px] font-bold text-white uppercase tracking-widest mb-4">
            Nossos diferenciais
          </span>
          <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-6">
            O que nos torna <span className="text-yellow-300">diferentes</span>?
          </h2>
          <p className="max-w-2xl mx-auto text-lg text-white/80 leading-relaxed">
            Unimos tecnologia proprietária e inteligência financeira para
            entregar o que realmente importa para o seu crescimento.
          </p>
        </div>

        <div className="max-w-[1280px] mx-auto grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4 relative z-10">
          {BENEFITS.map((b, i) => (
            <div
              key={b.title}
              className="group relative h-full rounded-[2.5rem] border border-white/10 bg-white/10 p-10 backdrop-blur-xl transition-all duration-300 hover:border-white/30 hover:bg-white/15 hover:-translate-y-2 shadow-2xl"
            >
              <div className="flex flex-col items-start gap-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-[#6d28d9] shadow-xl transition-all duration-500 group-hover:scale-110">
                  <b.icon className="h-8 w-8" strokeWidth={2} />
                </div>

                <div>
                  <h3 className="text-xl font-bold tracking-tight text-white mb-3">
                    {b.title}
                  </h3>
                  <p className="text-base leading-relaxed text-white/70 group-hover:text-white transition-colors">
                    {b.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* bottom wave to transition back to dark — CUTS the purple gradient */}
      <div className="absolute bottom-0 left-0 w-full z-20 pointer-events-none">
        <svg
          viewBox="0 0 1440 120"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          className="w-full h-[60px] md:h-[100px]"
        >
          <path
            d="M0,60 C360,120 1080,0 1440,60 L1440,120 L0,120 Z"
            fill="#070712"
          />
        </svg>
      </div>
    </section>
  );
}
