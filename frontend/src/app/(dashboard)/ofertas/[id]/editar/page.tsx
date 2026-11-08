import { OfferFormRoute } from '../../components/OfferFormRoute';

export default async function EditarOfertaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OfferFormRoute editId={id} />;
}
