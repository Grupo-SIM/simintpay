import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // Preserve imported checkout's dynamic gateway payloads during infrastructure migration.
  { rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  {
    // Imported forms synchronize URL/local-storage state in effects. Keep these
    // existing patterns visible as warnings while preserving payment behavior.
    files: [
      'src/components/card/creditCardForm.tsx',
      'src/components/simboleto/SimBoletoCheckout.tsx',
      'src/components/simlink/SimLinkCheckout/index.tsx',
      'src/components/simpixplan/SimPixPlanCheckout.tsx',
      'src/components/simplan/SimPlanCheckout.tsx',
      'src/components/simsubscriptionlink/SimSubscriptionLinkCheckout.tsx',
      'src/components/success/page.tsx',
      'src/components/telegram-success/index.tsx',
    ],
    rules: { 'react-hooks/set-state-in-effect': 'warn' },
  },
  globalIgnores(['.next/**', 'out/**', 'next-env.d.ts']),
]);
