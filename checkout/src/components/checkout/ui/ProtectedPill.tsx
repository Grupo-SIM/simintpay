import { Lock } from 'lucide-react';

export function ProtectedPill({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-white/[0.14] bg-white/[0.08] px-3 py-[7px] text-xs text-[#d9d4e3]">
        <Lock className="h-[13px] w-[13px] text-[#f6b67a]" strokeWidth={2} />
        100% Seguro
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/[0.13] bg-white/[0.07] px-4 py-2.5 text-sm text-[#d9d4e3] backdrop-blur-[20px]">
      <Lock className="h-4 w-4 text-[#f6b67a]" strokeWidth={2} />
      Pagamento 100% seguro
    </div>
  );
}
