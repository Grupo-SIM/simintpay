import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  /* config options here */
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
          // Headers para melhor performance mobile
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  // Configurações de compressão para mobile
  compress: true,
};

export default nextConfig;
