import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Nunito, Outfit } from 'next/font/google'; // Adicione esta importação
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Adicione a configuração para a fonte Nunito
const nunito = Nunito({
  variable: '--font-nunito',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'], // Defina os pesos da fonte que você deseja usar
});

// Fonte do checkout novo (SimLink) — aplicada só onde a classe .sp2 é usada
const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Simintpay · Checkout',
  description: 'Pagamento seguro com Simintpay',
  icons: { icon: '/3.ico' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="stylesheet" href="/rccs.css" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${nunito.variable} ${outfit.variable} min-h-screen font-nunito antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
