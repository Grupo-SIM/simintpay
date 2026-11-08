import { redirect } from 'next/navigation';
import { OfferFormRoute } from '../components/OfferFormRoute';

export default async function CriarOfertaPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  // Link antigo do assistente: ?id=<oferta> abria a edição.
  const { id } = await searchParams;
  if (id) redirect(`/ofertas/${encodeURIComponent(id)}/editar`);
  return <OfferFormRoute editId={null} />;
}
