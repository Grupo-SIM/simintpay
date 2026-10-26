import type { ReactNode } from 'react';

interface StatusHeaderProps {
  gradientClass: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
}

export function StatusHeader({
  gradientClass,
  icon,
  title,
  subtitle,
  badge,
}: StatusHeaderProps) {
  return (
    <div className={`rounded-xl ${gradientClass} p-6`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
            {icon}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">{title}</h1>
            {subtitle && (
              <p className="text-white/80 text-sm mt-0.5">{subtitle}</p>
            )}
          </div>
        </div>
        {badge && <div className="flex-shrink-0">{badge}</div>}
      </div>
    </div>
  );
}
