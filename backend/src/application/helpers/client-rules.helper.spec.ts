import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  CLIENT_MIN_AMOUNT,
  assertClientCanCreate,
  clientTaxaTagFor,
  isClientUser,
} from './client-rules.helper';

describe('client-rules.helper', () => {
  const approved = { email: 'v@v.com', clientStatus: 'APPROVED' };
  const pending = { email: 'v@v.com', clientStatus: 'PENDING' };
  const rejected = { email: 'v@v.com', clientStatus: 'REJECTED' };
  const notClient = { email: 'v@v.com', clientStatus: null };

  it('CLIENT_MIN_AMOUNT é 14.99', () => {
    expect(CLIENT_MIN_AMOUNT).toBe(14.99);
  });

  it('isClientUser true só quando clientStatus != null', () => {
    expect(isClientUser(approved)).toBe(true);
    expect(isClientUser(notClient)).toBe(false);
    expect(isClientUser(null)).toBe(false);
  });

  it('bloqueia cliente PENDING e REJECTED', () => {
    expect(() => assertClientCanCreate(pending, 20)).toThrow(
      ForbiddenException,
    );
    expect(() => assertClientCanCreate(rejected, 20)).toThrow(
      ForbiddenException,
    );
  });

  it('bloqueia valor abaixo do mínimo para cliente aprovado', () => {
    expect(() => assertClientCanCreate(approved, 14.98)).toThrow(
      BadRequestException,
    );
  });

  it('permite cliente aprovado com valor >= 14.99', () => {
    expect(() => assertClientCanCreate(approved, 14.99)).not.toThrow();
    expect(() => assertClientCanCreate(approved, 50)).not.toThrow();
  });

  it('não aplica regras a quem não é cliente', () => {
    expect(() => assertClientCanCreate(notClient, 1)).not.toThrow();
  });

  it('uses immutable merchant IDs for clients and ordinary accounts, never buyer email', () => {
    expect(clientTaxaTagFor({ ...approved, id: 'merchant' })).toBe(
      'USER:MERCHANT',
    );
    expect(clientTaxaTagFor({ ...notClient, id: 'merchant' })).toBe(
      'USER:MERCHANT',
    );
    expect(clientTaxaTagFor(approved)).toBeNull();
  });
});
