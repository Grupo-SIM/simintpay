import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/Toast';
import { AffiliatesButton } from '../AffiliatesButton';
import { AffiliateReceipts } from '../AffiliateReceipts';
import type { AffiliateProduct } from '@/features/affiliates/types';

const kind = (new URLSearchParams(location.search).get('kind') ??
  'plataformas') as AffiliateProduct;
localStorage.setItem('access_token', 'local-test');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <ToastProvider>
      {new URLSearchParams(location.search).get('view') === 'receipts' ? (
        <AffiliateReceipts />
      ) : (
        <AffiliatesButton product={kind} productId="owned" />
      )}
    </ToastProvider>
  </QueryClientProvider>,
);
