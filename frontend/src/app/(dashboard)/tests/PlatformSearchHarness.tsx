import { useState } from 'react';
import { PlatformSelect } from '@/components/product-platforms/PlatformSelect';

export function PlatformSearchHarness() {
  const [platform, setPlatform] = useState('');
  return (
    <>
      <PlatformSelect value={platform} onChange={setPlatform} />
      <output>{platform}</output>
    </>
  );
}
