import { redirect } from 'next/navigation';

/** Rota antiga do assistente: a criação/edição agora vive na tela única de ofertas. */
export default async function CriarOfertaRedirect({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  redirect(
    id
      ? `/cliente/ofertas?editar=${encodeURIComponent(id)}`
      : '/cliente/ofertas?novo=1',
  );
}
