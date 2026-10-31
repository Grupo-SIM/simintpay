'use client';

import { partnerLogos } from './simintpay-landing-data';

function LogoImage({
  logo,
  hidden = false,
}: {
  logo: (typeof partnerLogos)[number];
  hidden?: boolean;
}) {
  const className = ['sim-logos-track-img', logo.className]
    .filter(Boolean)
    .join(' ');

  return (
    <img
      className={className}
      src={logo.src}
      alt={hidden ? '' : logo.alt}
      aria-hidden={hidden || undefined}
    />
  );
}

export function SimPartnersLogosCarousel() {
  return (
    <div className="sim-logos-box">
      <div className="sim-logos-strip">
        <div className="sim-logos-track">
          {partnerLogos.map((logo) => (
            <LogoImage key={logo.src} logo={logo} />
          ))}
          {partnerLogos.map((logo) => (
            <LogoImage key={`${logo.src}-dup`} logo={logo} hidden />
          ))}
        </div>
      </div>
    </div>
  );
}
