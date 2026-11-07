import { Suspense } from 'react';
import { configuredPreviewParents } from '@/lib/payment-link-preview';
import { FunnelPreview } from './FunnelPreview';

// Read the allowlist at runtime: Docker builds need no additional public build argument.
export const dynamic = 'force-dynamic';

export default function FunnelPreviewPage() {
  return (
    <Suspense fallback={<div role="status">Carregando prévia…</div>}>
      <FunnelPreview allowedOrigins={configuredPreviewParents()} />
    </Suspense>
  );
}
