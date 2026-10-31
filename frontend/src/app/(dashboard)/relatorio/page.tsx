'use client';

import { useCurrentUser } from '@/hooks/use-current-user';
import { ReportSkeleton } from './components/ReportSkeleton';
import { UnifiedReports } from './components/UnifiedReports';

export default function RelatorioPage() {
  const { user, loading } = useCurrentUser();
  if (loading) return <ReportSkeleton />;
  if (!user) return <p role="alert">Não foi possível verificar sua sessão.</p>;
  return <UnifiedReports key={user.id} />;
}
