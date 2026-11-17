import { NextRequest, NextResponse } from 'next/server';
import {
  configuredPreviewParents,
  previewFramePolicy,
} from './lib/payment-link-preview';
import { offerRedirectTarget } from './lib/legacy-offer-redirect';

/** Keep ordinary checkout embedding unchanged; scope preview policy to this route. */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    const target = offerRedirectTarget(request.nextUrl);
    if (target) return NextResponse.redirect(target);
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
  matcher: ['/', '/preview/payment-link', '/preview/offer', '/preview/funnel'],
};
