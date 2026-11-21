import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/Toast';
import { AffiliateReceipts } from '../AffiliateReceipts';

localStorage.setItem('access_token', 'local-test');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <ToastProvider>
      <AffiliateReceipts />
    </ToastProvider>
  </QueryClientProvider>,
);
