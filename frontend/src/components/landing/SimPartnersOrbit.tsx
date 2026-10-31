'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { partnerLogos } from './simintpay-landing-data';

/**
 * Partners "integrations" layout: two horizontal marquee rows of partner
 * logo tiles scrolling in opposite directions, with a central glowing orb
 * (SimIntPay mark) sitting on top of them. Inspired by the reference design.
 */

type Logo = (typeof partnerLogos)[number];

function Tile({
  className,
  logo,
  hidden = false,
}: {
  className?: string;
  logo: Logo;
  hidden?: boolean;
}) {
  return (
    <div className="sim-orbit-tile" aria-hidden={hidden || undefined}>
      <img
        className={[cn('sim-orbit-logo', className), logo.className]
          .filter(Boolean)
          .join(' ')}
        src={logo.src}
        alt={hidden ? '' : logo.alt}
        loading="lazy"
      />
    </div>
  );
}

function MarqueeRow({
  logos,
  reverse = false,
}: {
  logos: Logo[];
  reverse?: boolean;
}) {
  return (
    <div className="sim-orbit-row">
      <div
        className={`sim-orbit-track${reverse ? ' sim-orbit-track--reverse' : ''}`}
      >
        {logos.map((logo) => (
          <Tile key={logo.src} logo={logo} className="w-full" />
        ))}
        {logos.map((logo) => (
          <Tile key={`${logo.src}-dup`} logo={logo} hidden className="w-full" />
        ))}
      </div>
    </div>
  );
}

export function SimPartnersOrbit() {
  const [topLogos, bottomLogos] = useMemo(() => {
    const sortedLogos = [...partnerLogos].sort((a, b) =>
      a.alt.localeCompare(b.alt),
    );

    return [
      sortedLogos.slice(0, Math.ceil(partnerLogos.length / 2)),
      sortedLogos.slice(Math.ceil(partnerLogos.length / 2)),
    ];
  }, []);

  return (
    <div className="sim-orbit">
      <div className="sim-orbit-rows">
        <MarqueeRow logos={topLogos} />
        <MarqueeRow logos={bottomLogos} reverse />
      </div>

      <div className="sim-orbit-center" aria-hidden="true">
        <div className="sim-orbit-glow" />
        <div className="sim-orbit-ring" />
        <div className="sim-orbit-core">
          <img
            src="/simintpay-branca.svg"
            alt="SimIntPay"
            className="sim-orbit-core-img"
          />
        </div>
      </div>
    </div>
  );
}
