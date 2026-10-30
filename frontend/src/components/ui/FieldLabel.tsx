import type { ReactNode } from 'react';
import { HelpTooltip } from './HelpTooltip';

type Props = {
  children: ReactNode;
  required?: boolean;
  info?: string;
  infoText?: string;
};

export function FieldLabel({ children, required, info, infoText }: Props) {
  const explanation = infoText ?? info;
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
      {children}
      {required ? <span className="text-red-500">*</span> : null}
      {explanation ? <HelpTooltip>{explanation}</HelpTooltip> : null}
    </span>
  );
}
