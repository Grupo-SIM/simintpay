import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/Toast';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import PaymentLink from '../links-pagamento/criar/page';
import SubscriptionLink from '../links-assinatura/criar/page';
import Plan from '../planos/criar/page';
import PixPlan from '../planos-pix/criar/page';
import Boleto from '../boletos/criar/page';
const pages = [PaymentLink, SubscriptionLink, Plan, PixPlan, Boleto];
const Page =
  pages[Number(new URLSearchParams(location.search).get('product') ?? 0)];
localStorage.setItem('access_token', 'local-test');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <ThemeProvider>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </ThemeProvider>
  </QueryClientProvider>,
);
