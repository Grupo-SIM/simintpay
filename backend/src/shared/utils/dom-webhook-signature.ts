import { UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A DOM assina cada postback com um JWT HS256 (campo `signature`) usando o token da
 * conta central (`DOM_TOKEN`). Rejeita qualquer webhook cuja assinatura não confira,
 * inclusive quando o token não está configurado (fail-closed).
 */
export function assertDomWebhookSignature(body: unknown): void {
  const token = String(process.env.DOM_TOKEN ?? '').trim();
  const signature =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).signature
      : undefined;
  if (!token || typeof signature !== 'string')
    throw new UnauthorizedException('Webhook DOM inválido');
  const parts = signature.split('.');
  if (parts.length !== 3)
    throw new UnauthorizedException('Assinatura DOM inválida');
  const [header, payload, supplied] = parts;
  try {
    const alg = (
      JSON.parse(Buffer.from(header, 'base64url').toString()) as {
        alg?: string;
      }
    ).alg;
    if (alg !== 'HS256') throw new Error('alg');
  } catch {
    throw new UnauthorizedException('Assinatura DOM inválida');
  }
  const expected = createHmac('sha256', token)
    .update(`${header}.${payload}`)
    .digest();
  const received = Buffer.from(supplied, 'base64url');
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new UnauthorizedException('Assinatura DOM inválida');
}
