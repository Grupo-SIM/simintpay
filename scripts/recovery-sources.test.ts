import { Prisma } from '@prisma/client';
import { domPatch, provenUser, usersFromBackup } from './recovery-sources';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('recovery sources', () => {
  it('reads only User identity from pg_dump COPY', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'recovery-'));
    try {
      const path = join(dir, 'backup.sql');
      writeFileSync(path, 'COPY public."User" (id, name, email, role, "isActive", "isPurged") FROM stdin;\n' +
        'id-1\tMaria\\tSilva\tMARIA@example.com\tUSER\tt\tf\n' +
        'id-2\tExcluído\tex@example.com\tUSER\tt\tt\n\\.\n');
      const users = await usersFromBackup(path);
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Maria\tSilva');
      expect(users[0].email).toBe('maria@example.com');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('requires identity and matching DOM payment before enrichment', () => {
    expect(() => provenUser({ id: 'id', name: 'A', email: null }, 'BACKUP')).toThrow();
    const row = { id: 'local', domTransactionId: 'dom-1', domPaymentId: 'pay-1',
      amount: new Prisma.Decimal('10.00'), netAmount: null, description: null,
      customerName: null, customerEmail: null, customerDocument: null, customerPhone: null };
    expect(domPatch(row, { data: { id: 'dom-1', amount: 1000, liquid_amount: 900,
      customer: { name: 'Ana', email: 'ana@example.com' } } })).toEqual({
        customerName: 'Ana', customerEmail: 'ana@example.com', netAmount: new Prisma.Decimal('9'),
      });
    expect(() => domPatch(row, { data: { id: 'another', amount: 1000 } })).toThrow();
    expect(domPatch(row, { data: { id: 'dom-1', amount: 1100, liquid_amount: 900 } })).toEqual({});
  });
});
