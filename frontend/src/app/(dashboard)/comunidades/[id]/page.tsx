'use client';

import { useParams } from 'next/navigation';
import { ComunidadeDetailsView } from '../components/ComunidadeDetailsView';

export default function ComunidadeDetalhePage() {
  const params = useParams<{ id: string }>();
  return (
    <ComunidadeDetailsView
      communityId={params.id}
      backHref="/admin/contas?tab=clientes"
    />
  );
}
