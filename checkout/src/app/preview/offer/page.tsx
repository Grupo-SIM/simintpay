import { Suspense } from 'react';
import { configuredPreviewParents } from '@/lib/payment-link-preview';
import { OfferPreview as PaymentLinkPreview } from './OfferPreview';

// Read the allowlist at runtime: Docker builds need no additional public build argument.
export const dynamic = 'force-dynamic';

export default function PaymentLinkPreviewPage() {
  return (
    <Suspense fallback={<div role="status">Carregando prévia…</div>}>
      <PaymentLinkPreview allowedOrigins={configuredPreviewParents()} />
    </Suspense>
  );
}
