import { ProductPlatformFixture } from './ProductPlatformFixture';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/Toast';
import { PlatformManager } from '../PlatformManager';
import AdminFees from '@/app/(dashboard)/admin/taxas/page';

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
localStorage.setItem('access_token', 'local-test');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ToastProvider>
      {location.search.includes('product') ? (
        <ProductPlatformFixture />
      ) : location.search.includes('admin') ? (
        <AdminFees />
      ) : (
        <PlatformManager />
      )}
    </ToastProvider>
  </QueryClientProvider>,
);
