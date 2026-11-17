import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/Toast';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import Accounts from '../admin/contas/page';
import Transactions from '../transacoes/page';
import Withdrawals from '../saques/page';
import Overview from '../relatorio/components/AdminReportOverview';
import { Sidebar } from '@/components/layout/sidebar';
import { PlatformSearchHarness } from './PlatformSearchHarness';
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const path = location.pathname;
const content = path.startsWith('/admin/contas') ? (
  <Accounts />
) : path === '/transacoes' ? (
  <Transactions />
) : path === '/saques' ? (
  <Withdrawals />
) : path === '/report' ? (
  <Overview range={{ start: null, end: null }} />
) : path === '/sidebar' ? (
  <Sidebar />
) : (
  <PlatformSearchHarness />
);
localStorage.setItem('access_token', 'local-test');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ThemeProvider>
      <ToastProvider>{content}</ToastProvider>
    </ThemeProvider>
  </QueryClientProvider>,
);
