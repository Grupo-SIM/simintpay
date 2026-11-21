import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/Toast';
import { ParticipationsButton } from '../ParticipationsButton';

const kind =
  new URLSearchParams(location.search).get('kind') === 'plataformas'
    ? 'plataformas'
    : 'ofertas';
localStorage.setItem('access_token', 'local-test');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <ToastProvider>
      <ParticipationsButton product={kind} productId="owned" />
    </ToastProvider>
  </QueryClientProvider>,
);
