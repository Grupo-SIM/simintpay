import { redirect } from 'next/navigation';

/** Legacy URLs never reconstruct checkout or accept payment data from the URL. */
export default async function LegacyPaymentLinkPreview({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const params = new URLSearchParams({ legacyPreview: '1' });
  if (typeof id === 'string' && id) params.set('id', id);
  redirect(`/links-pagamento/criar?${params.toString()}`);
}
