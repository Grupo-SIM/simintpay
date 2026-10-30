/** Product areas remain separate from operational/admin routes. */
const CLIENT_SHARED_ROUTES = [
  '/painel',
  '/transacoes',
  '/saques',
  '/saque',
  '/extrato',
  '/cobrancas',
  '/relatorio',
  '/plataformas',
  '/taxas',
  '/configuracoes/perfil',
];

export function canClientAccessPath(pathname: string): boolean {
  if (pathname === '/cliente' || pathname.startsWith('/cliente/')) return true;
  // Dashboards for other platforms are not the client's /painel.
  if (pathname === '/painel') return true;
  return CLIENT_SHARED_ROUTES.filter((route) => route !== '/painel').some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}
