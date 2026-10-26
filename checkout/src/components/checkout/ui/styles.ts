/** Painel de vidro (fosco). No desktop ganha blur maior + saturação + brilho interno. */
export const GLASS =
  'border border-white/[0.13] bg-white/[0.07] backdrop-blur-[24px] lg:backdrop-blur-[28px] lg:backdrop-saturate-[1.4] lg:shadow-[inset_0_1px_0_rgba(255,255,255,.1)]';

/** Mesmo vidro, mas só a partir do desktop (no mobile o bloco fica "solto"). */
export const LG_GLASS =
  'lg:border lg:border-white/[0.13] lg:bg-white/[0.07] lg:backdrop-blur-[28px] lg:backdrop-saturate-[1.4] lg:shadow-[inset_0_1px_0_rgba(255,255,255,.1)]';

/** Vidro só no mobile (no desktop o bloco fica dentro de outro painel). */
export const SM_GLASS =
  'border border-white/[0.13] bg-white/[0.07] backdrop-blur-[24px] lg:border-0 lg:bg-transparent lg:backdrop-blur-none';
