import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  override canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    // 🔓 REAL TEST BYPASS (Development Only)
    // Se estiver em desenvolvimento e houver um token, extraímos os dados REAIS mesmo sem conferir a assinatura.
    if (process.env.NODE_ENV === 'development') {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
          // Verifica se parece um JWT (3 partes)
          const parts = token.split('.');
          if (parts.length === 3) {
            // Decodifica o JWT manualmente (Base64) para pegar os dados do usuário real
            const payloadBase64 = parts[1];
            const payloadJson = Buffer.from(payloadBase64, 'base64').toString();
            const payload = JSON.parse(payloadJson);

            request.user = {
              sub: payload.sub || payload.id || 'dev-unknown',
              email: payload.email || '',
              role: payload.role || payload.roles?.[0] || 'USER'
            };
          } else {
            // Se não for JWT, usamos o token inteiro como ID Simulado (para testes de API Key)
            request.user = {
              sub: token, 
              email: `legacy-${token.substring(0, 8)}@simpay.com`,
              role: 'USER'
            };
          }
          return true;
        } catch (e) {
          // Se falha no decode manual, ignora e tenta o padrão
        }
      }
    }

    return super.canActivate(context);
  }

  override handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      if (process.env.NODE_ENV === 'development') {
        return user; // O canActivate já deve ter populado o user se houvesse token
      }
      throw err || new UnauthorizedException();
    }
    return user;
  }
}
