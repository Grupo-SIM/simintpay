import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminReportOverview from '../components/AdminReportOverview';

localStorage.setItem('access_token', 'fixture-token');
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <AdminReportOverview
      range={{ start: new Date(2026, 9, 1), end: new Date(2026, 9, 19) }}
    />
  </QueryClientProvider>,
);
