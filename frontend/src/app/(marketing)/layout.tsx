import type { ReactNode } from 'react';
import '@fontsource/inter/latin-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/lora/latin-600-italic.css';
import '@fontsource/poppins/latin-800.css';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
