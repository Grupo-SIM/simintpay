'use client';

import { useState } from 'react';
import { PlatformHeader } from './PlatformHeader';
import { PlatformPickerModal } from './PlatformPickerModal';
import type { Platform } from './types';

export function PlatformSelectionHeader({
  platforms,
  selectedTag,
  onSelect,
  admin = false,
}: {
  platforms: Platform[];
  selectedTag?: string;
  onSelect: (tag: string) => void;
  admin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedName =
    selectedTag === 'GLOBAL'
      ? 'Padrão global'
      : (platforms.find((platform) => platform.tag === selectedTag)?.name ??
        'Plataformas');
  return (
    <>
      <PlatformHeader
        title={admin ? 'Taxas e juros' : 'Plataformas'}
        description={
          admin
            ? 'Configure taxas e juros SimIntPay, comparando custos internos das adquirentes.'
            : 'Crie plataformas, ajuste juros do comprador e confira custos antes de vender.'
        }
        selectedName={selectedName}
        open={open}
        onOpen={() => setOpen(true)}
        admin={admin}
      />
      {open && (
        <PlatformPickerModal
          platforms={platforms}
          selectedTag={selectedTag}
          admin={admin}
          onSelect={(tag) => {
            onSelect(tag);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
