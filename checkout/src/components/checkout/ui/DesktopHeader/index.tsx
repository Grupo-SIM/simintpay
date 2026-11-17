import { Logo } from '../Logo';
import { ProtectedPill } from '../ProtectedPill';
import { Stepper } from './components';

/** Header desktop: logo · stepper (opcional) · selo "Pagamento 100% seguro". Oculto no mobile. */
export function DesktopHeader({
  step,
  badge,
}: {
  step?: 1 | 2 | 3;
  /** Texto alternativo do selo (ex.: "Pagamento protegido"). */
  badge?: string;
}) {
  return (
    <header className="hidden items-center justify-between gap-6 lg:flex">
      <Logo size="lg" />
      {step && <Stepper current={step} />}
      <ProtectedPill label={badge} />
    </header>
  );
}
