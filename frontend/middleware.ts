import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  console.log(`[Middleware] Pathname: ${pathname}`);
  const token = req.cookies.get('access_token')?.value;
  console.log(
    `[Middleware] Access Token: ${token ? 'Present' : 'Not Present'}`,
  );

  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    console.log(`[Middleware] Redirecting to: ${url.toString()}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/painel/:path*',
    '/saque/:path*',
    '/extrato/:path*',
    '/transacoes/:path*',
    '/relatorio/:path*',
    '/planos/:path*',
    '/assinantes/:path*',
    '/links-pagamento/:path*',
    '/downloads/:path*',
    '/configuracoes/:path*',
  ],
};
