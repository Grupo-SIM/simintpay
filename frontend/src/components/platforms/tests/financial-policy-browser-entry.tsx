import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/Toast';
import { FinancialPolicyEditor } from '../FinancialPolicyEditor';

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ToastProvider>
      <FinancialPolicyEditor
        tag="SHOP"
        admin={new URLSearchParams(window.location.search).has('admin')}
      />
    </ToastProvider>
  </QueryClientProvider>,
);
