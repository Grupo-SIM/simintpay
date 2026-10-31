import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clearUserCache } from '@/hooks/use-current-user';
import { ToastProvider } from '@/components/ui/Toast';
import RelatorioPage from '../page';

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 } },
});
function Harness() {
  const [version, setVersion] = useState(0);
  return (
    <QueryClientProvider client={client}>
      <button
        onClick={() => {
          clearUserCache();
          setVersion((v) => v + 1);
        }}
      >
        Trocar sessão
      </button>
      <ToastProvider>
        <RelatorioPage key={version} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
localStorage.setItem('access_token', 'fixture-token');
createRoot(document.getElementById('root')!).render(<Harness />);
