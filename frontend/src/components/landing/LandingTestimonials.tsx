import Image from 'next/image';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

const TESTIMONIALS = [
  {
    name: 'Amanda Rocha',
    role: 'Dona de e-commerce',
    image:
      'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=70',
    quote:
      'A experiência de checkout ficou muito mais elegante e nossa conversão melhorou já na primeira semana.',
  },
  {
    name: 'Rafael Martins',
    role: 'Infoprodutor',
    image:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=70',
    quote:
      'Em poucos dias consegui organizar assinaturas e links de pagamento sem esforço e com ótima aprovação.',
  },
  {
    name: 'Juliana Prado',
    role: 'Gestora financeira',
    image:
      'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=200&q=70',
    quote:
      'A clareza dos relatórios e a velocidade para receber os valores deram outra previsibilidade para o caixa.',
  },
  {
    name: 'Caio Nunes',
    role: 'Empresário',
    image:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=200&q=70',
    quote:
      'A plataforma passa confiança para o cliente final e o suporte sempre responde rápido quando precisamos.',
  },
];

function TestimonialCard({
  name,
  role,
  quote,
  image,
}: {
  name: string;
  role: string;
  quote: string;
  image: string;
}) {
  return (
    <Card className="w-[300px] shrink-0 border-white/15 bg-white/[0.04] backdrop-blur-md">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/20">
            <Image
              src={image}
              alt={`Foto de ${name}`}
              fill
              className="object-cover"
            />
          </div>
          <div>
            <CardTitle className="text-sm text-white">{name}</CardTitle>
            <div className="text-xs text-white/60">{role}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-white/75">&quot;{quote}&quot;</p>
      </CardContent>
    </Card>
  );
}

function InfiniteTrack({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden border-y border-white/10 bg-white/[0.02] py-4 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
      <div className="flex w-max gap-4 animate-[carousel_26s_linear_infinite]">
        {children}
        {children}
      </div>
      <div className="pointer-events-none absolute inset-y-2 left-0 w-20 bg-[radial-gradient(85%_70%_at_0%_50%,rgba(8,8,11,0.36)_0%,rgba(8,8,11,0.2)_45%,rgba(8,8,11,0)_100%)] blur-md" />
      <div className="pointer-events-none absolute inset-y-2 right-0 w-20 bg-[radial-gradient(85%_70%_at_100%_50%,rgba(8,8,11,0.36)_0%,rgba(8,8,11,0.2)_45%,rgba(8,8,11,0)_100%)] blur-md" />
    </div>
  );
}

const TESTIMONIAL_ITEMS = TESTIMONIALS.map((t) => (
  <TestimonialCard
    key={t.name}
    name={t.name}
    role={t.role}
    quote={t.quote}
    image={t.image}
  />
));

const carouselStyles = `
@keyframes carousel {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
`;

export function LandingTestimonials() {
  return (
    <section id="clientes" className="py-16 md:py-44">
      <style>{carouselStyles}</style>1
      <div className="w-full px-6 mb-8 lg:px-20">
        <h2 className="text-3xl font-semibold tracking-tight text-white">
          Quem escolhe a plataforma, não se arrepende
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-7 text-white/70">
          Depoimentos de demonstração.
        </p>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
          Pessoas que usaram a plataforma
        </p>
      </div>
      {/* Carrossel full bleed — até as duas bordas */}
      <div className="w-full overflow-hidden">
        <InfiniteTrack>{TESTIMONIAL_ITEMS}</InfiniteTrack>
      </div>
    </section>
  );
}
