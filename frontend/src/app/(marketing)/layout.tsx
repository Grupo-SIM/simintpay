import type { ReactNode } from 'react';
import { Inter, Lora, Poppins } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-landing-inter',
});

const lora = Lora({
  subsets: ['latin'],
  weight: ['600'],
  style: ['italic'],
  variable: '--font-landing-lora',
});

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['800'],
  variable: '--font-landing-poppins',
});

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${inter.variable} ${lora.variable} ${poppins.variable}`}>
      {children}
    </div>
  );
}
