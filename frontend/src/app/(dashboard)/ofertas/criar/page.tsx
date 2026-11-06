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
      ? `/ofertas?editar=${encodeURIComponent(id)}`
      : '/ofertas?novo=1',
  );
}
