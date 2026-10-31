import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/Toast';
import { CoproductionReceipts } from '../CoproductionReceipts';
import { CoproductionButton } from '../CoproductionButton';
import type { CoproductionProduct } from '@/features/coproduction/types';
import { CoproductionCreateHarness } from './CoproductionCreateHarness';

const kind =
  (new URLSearchParams(location.search).get('kind') as CoproductionProduct) ??
  'planos';
localStorage.setItem('access_token', 'local-test');
const view = new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <ToastProvider>
      {view === 'receipts' ? (
        <CoproductionReceipts />
      ) : view === 'create' ? (
        <CoproductionCreateHarness kind={kind} />
      ) : (
        <CoproductionButton product={kind} productId="owned" />
      )}
    </ToastProvider>
  </QueryClientProvider>,
);
