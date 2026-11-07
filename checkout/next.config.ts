import type { NextConfig } from 'next';
import { resolve } from 'node:path';

// Query params dos links antigos. As tabelas antigas estão sendo migradas para ofertas mantendo o
// mesmo UUID, então o valor do param vira o `oferta`.
const LEGACY_OFFER_PARAMS = [
  'simPlanCode',
  'simLinkCode',
  'simBoletoCode',
  'subscriptionLinkCode',
  'linkCode',
  'subscriptionCode',
  'ofertaCode',
];

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  env: {
    // Variáveis de ambiente para configuração mobile
    NEXT_PUBLIC_MOBILE_TIMEOUT: '20000',
    NEXT_PUBLIC_MOBILE_RETRY_ATTEMPTS: '3',
    NEXT_PUBLIC_ENABLE_MOBILE_OPTIMIZATION: 'true',
  },
  output: 'standalone',
  outputFileTracingRoot: resolve(import.meta.dirname, '..'),
  // Configurações para resolver erro do critters
  experimental: {
    // Desabilitar otimizações que causam problemas
    optimizeCss: false,
    optimizePackageImports: ['lucide-react'],
  },
  async redirects() {
    return LEGACY_OFFER_PARAMS.map((param) => ({
      source: '/',
      has: [{ type: 'query' as const, key: param, value: '(?<legacyCode>.+)' }],
      missing: [{ type: 'query' as const, key: 'oferta' }],
      destination: '/?oferta=:legacyCode',
      permanent: false,
    }));
  },
  // Headers para melhor compatibilidade mobile
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Isso quebrava o checkout em iframes
          // {
          //   key: 'X-Frame-Options',
          //   value: 'DENY',
          // },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          // Headers para melhor performance mobile (só em produção: em dev
          // o navegador passa a servir chunks antigos do Turbopack)
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Cache-Control',
                  value: 'public, max-age=31536000, immutable',
                },
              ]
            : []),
        ],
      },
    ];
  },
  // Configurações de compressão para mobile
  compress: true,
};

export default nextConfig;
