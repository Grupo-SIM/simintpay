import { Check } from 'lucide-react';

export function CheckDot({ size }: { size: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#a99ef8,#f6b67a)]"
      style={{ width: size, height: size }}
    >
      <Check
        className="text-[#17131f]"
        style={{ width: size / 2.1, height: size / 2.1 }}
        strokeWidth={3}
      />
    </span>
  );
}
