'use client';

import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

export function PlatformCredentialField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  const { toast } = useToast();
  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast({ type: 'success', title: `${label} copiado` });
    } catch {
      toast({
        type: 'error',
        title: 'Não foi possível copiar',
        description: 'Selecione e copie o valor manualmente.',
      });
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <Button
          type="button"
          variant="outline"
          disabled={!value}
          aria-label={`Copiar ${label}`}
          className="cursor-pointer disabled:cursor-not-allowed"
          onClick={() => void copy()}
        >
          <Copy size={16} />
          Copiar
        </Button>
      </div>
      <code className="block break-all rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-white/10 dark:bg-white/5">
        {value || 'Não configurado'}
      </code>
    </div>
  );
}
