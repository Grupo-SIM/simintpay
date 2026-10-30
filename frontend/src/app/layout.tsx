import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import NextTopLoader from 'nextjs-toploader';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ScrollToTopOnPathChange } from '@/components/layout/ScrollToTopOnPathChange';
import { QueryProvider } from '@/providers/QueryProvider';
import Preloader from '@/components/ui/Preloader';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Simintpay',
  description: 'Gerenciamento inteligente, resultados reais.',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Preloader />
        <NextTopLoader
          color="#8B5CF6"
          height={3}
          showSpinner={false}
          easing="ease"
          speed={240}
          shadow="0 0 10px #8B5CF6,0 0 5px #8B5CF6"
        />
        <ThemeProvider>
          <QueryProvider>
            <ScrollToTopOnPathChange>
              <ToastProvider>{children}</ToastProvider>
            </ScrollToTopOnPathChange>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
