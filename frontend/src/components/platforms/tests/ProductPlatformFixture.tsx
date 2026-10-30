import { useState } from 'react';
import { ProductPlatformSelect } from '@/components/product-platforms/ProductPlatformSelect';
import { useProductPlatforms } from '@/hooks/use-product-platforms';

export function ProductPlatformFixture() {
  const catalog = useProductPlatforms();
  const [value, setValue] = useState<string | null>(null);
  return (
    <ProductPlatformSelect
      catalog={catalog}
      value={value}
      onChange={setValue}
      theme="light"
    />
  );
}
