import { useState } from 'react';
import { PlatformFilterSelect } from '@/components/product-platforms/PlatformFilterSelect';

export function PlatformSearchHarness() {
  const [platform, setPlatform] = useState('');
  return (
    <>
      <PlatformFilterSelect
        label="Plataforma"
        options={[{ value: '', label: 'Todas' }]}
        value={platform}
        onChange={setPlatform}
      />
      <output>{platform}</output>
    </>
  );
}
