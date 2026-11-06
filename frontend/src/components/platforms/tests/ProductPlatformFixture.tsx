import { useState } from 'react';
import { ProductPlatformSection } from '@/app/(dashboard)/cliente/components/ProductPlatformSection';
import { useProductPlatforms } from '@/hooks/use-product-platforms';

export function ProductPlatformFixture() {
  const catalog = useProductPlatforms();
  const [value, setValue] = useState<string | null>(null);
  return (
    <>
      <ProductPlatformSection
        catalog={catalog}
        value={value}
        onChange={setValue}
        theme="light"
      />
      <button
        type="button"
        disabled={!catalog.isDestinationValid(value)}
        onClick={() => {
          document.getElementById('destination')!.textContent = JSON.stringify(
            catalog.destinationBody(value),
          );
        }}
      >
        Salvar destino
      </button>
      <output id="destination" />
    </>
  );
}
