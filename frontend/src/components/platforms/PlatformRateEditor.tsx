'use client';

import { FinancialPolicyEditor } from './FinancialPolicyEditor';
import type { Platform } from './types';

export function PlatformRateEditor({ platform }: { platform: Platform }) {
  return <FinancialPolicyEditor tag={platform.tag} name={platform.name} />;
}
