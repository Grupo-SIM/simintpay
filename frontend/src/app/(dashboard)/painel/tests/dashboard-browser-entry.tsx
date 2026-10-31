import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import PainelPage from '../page';

localStorage.setItem('access_token', 'fixture-token');
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <PainelPage />
  </ThemeProvider>,
);
