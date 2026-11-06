import { NextRequest, NextResponse } from 'next/server';
import {
  configuredPreviewParents,
  previewFramePolicy,
} from './lib/payment-link-preview';

const LEGACY_OFFER_PARAMS = [
  'simPlanCode',
  'simLinkCode',
  'simBoletoCode',
  'subscriptionLinkCode',
  'linkCode',
  'subscriptionCode',
  'ofertaCode',
];

/** Keep ordinary checkout embedding unchanged; scope preview policy to this route. */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    const legacyCode = LEGACY_OFFER_PARAMS.map((param) =>
      url.searchParams.get(param),
    ).find(Boolean);

    if (legacyCode || url.searchParams.get('oferta')) {
      if (!url.searchParams.get('oferta') && legacyCode) {
        url.searchParams.set('oferta', legacyCode);
      }
      const hasLegacyParams = LEGACY_OFFER_PARAMS.some((param) =>
        url.searchParams.has(param),
      );
      if (hasLegacyParams) {
        for (const param of LEGACY_OFFER_PARAMS) url.searchParams.delete(param);
        return NextResponse.redirect(url);
      }
    }
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.headers.set(
    'Content-Security-Policy',
    previewFramePolicy(
      configuredPreviewParents(),
      process.env.NODE_ENV === 'development',
    ),
  );
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.delete('X-Frame-Options');
  return response;
}

export const config = {
  matcher: ['/', '/preview/payment-link', '/preview/offer'],
};
