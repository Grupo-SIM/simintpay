const COMPANIES = [
  'Nova Store',
  'Atlas Digital',
  'Viva Clinic',
  'Pixel House',
  'Prime Foods',
  'Blue Mobility',
  'Solar Hub',
  'Urban Fit',
  'LumeTech',
  'Verde Farma',
];

function CompanyBadge({ name }: { name: string }) {
  return (
    <div className="flex h-16 w-[220px] shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/[0.04] px-4 text-sm font-semibold text-white/90 backdrop-blur-md">
      {name}
    </div>
  );
}

const COMPANY_ITEMS = COMPANIES.map((name) => (
  <CompanyBadge key={name} name={name} />
));

const carouselStyles = `
@keyframes carousel-companies {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
`;

export function LandingCompanies() {
  return (
    <section className="py-14 md:py-40">
      <style>{carouselStyles}</style>

      <div className="w-full px-6 mb-5 lg:px-20">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
          Empresas
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">
          Empresas que usam nossa plataforma
        </h3>
      </div>

      {/* Carrossel full bleed — até as duas bordas */}
      <div className="w-full overflow-hidden">
        <div className="relative overflow-hidden border-y border-white/10 bg-white/[0.02] py-4 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="flex w-max gap-4 animate-[carousel-companies_30s_linear_infinite]">
            {COMPANY_ITEMS}
            {COMPANY_ITEMS}
          </div>
          <div className="pointer-events-none absolute inset-y-2 left-0 w-20 bg-[radial-gradient(85%_70%_at_0%_50%,rgba(8,8,11,0.36)_0%,rgba(8,8,11,0.2)_45%,rgba(8,8,11,0)_100%)] blur-md" />
          <div className="pointer-events-none absolute inset-y-2 right-0 w-20 bg-[radial-gradient(85%_70%_at_100%_50%,rgba(8,8,11,0.36)_0%,rgba(8,8,11,0.2)_45%,rgba(8,8,11,0)_100%)] blur-md" />
        </div>
      </div>
    </section>
  );
}
