'use client';

import { useState, type ReactNode } from 'react';
import { PlatformHeader } from './PlatformHeader';
import { PlatformPickerModal } from './PlatformPickerModal';
import type { Platform } from './types';

export function PlatformSelectionHeader({
  platforms,
  selectedTag,
  onSelect,
  admin = false,
  actions,
}: {
  platforms: Platform[];
  selectedTag?: string;
  onSelect: (tag: string) => void;
  admin?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const selectedName =
    selectedTag === 'GLOBAL'
      ? 'Padrão global'
      : selectedTag?.startsWith('USER:')
        ? 'Selecionar plataforma'
        : (platforms.find((platform) => platform.tag === selectedTag)?.name ??
          'Plataformas');
  return (
    <>
      <PlatformHeader
        title={admin ? 'Taxas e juros' : 'Plataformas'}
        description={
          admin
            ? 'Configure taxas e juros SimIntPay, comparando custos internos das adquirentes.'
            : 'Gerencie suas plataformas e consulte plataformas compartilhadas em coprodução, somente leitura.'
        }
        selectedName={selectedName}
        open={open}
        onOpen={() => setOpen(true)}
        admin={admin}
        actions={actions}
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
