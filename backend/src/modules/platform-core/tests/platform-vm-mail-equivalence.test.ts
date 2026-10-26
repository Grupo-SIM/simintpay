import 'reflect-metadata';
import { expect, mock, test } from 'bun:test';
import { AtlasMailController } from '../../atlas/controllers/atlas-mail.controller';
import { AtlasMailService } from '../../atlas/services/atlas-mail.service';
import { PlatformCorporateController } from '../platform-corporate.controller';

function fixture() {
  const messages: unknown[] = [];
  const mail = new AtlasMailService();
  // Exercise actual VM template generation; replace only SMTP boundary.
  mail.sendMail = mock(async message => { messages.push(message); });
  const modules = { get: (token: unknown) => { expect(token).toBe(AtlasMailService); return mail; } };
  return { messages, mail, alias: new AtlasMailController(mail), canonical: new PlatformCorporateController(modules as any, {} as any) };
}
const body = { email: 'buyer@example.com', vmIp: '192.0.2.10', vmPassword: 'mock-vm-password' };
const context = { id: 'atlas', tag: 'ATLAS', ownerUserId: 'owner', acquirer: 'DOM' as const };

test('Atlas VM mail alias and canonical capability generate identical recipient and template', async () => {
  const { alias, canonical, messages } = fixture();
  expect(await alias.sendVmAccess(body)).toEqual({ success: true, message: 'E-mail de acesso enviado com sucesso' });
  expect(await canonical.vmAccess({ platformContext: context }, body)).toEqual({ success: true });
  expect(messages).toHaveLength(2);
  expect(messages[0]).toEqual(messages[1]);
  expect(messages[0]).toMatchObject({ to: body.email, subject: 'Dados de acesso da sua VM — Atlashost' });
  expect((messages[0] as { html: string }).html).toContain(body.vmIp);
  expect((messages[0] as { html: string }).html).toContain(body.vmPassword);
  expect(Reflect.getMetadata('platform-operation', canonical.vmAccess)).toBe('mail:send');
});

test('VM mail capability rejects other products before SMTP', async () => {
  const { canonical, messages } = fixture();
  try {
    await canonical.vmAccess({ platformContext: { ...context, tag: 'CLIENT-A' } }, body);
    throw new Error('Expected unavailable capability');
  } catch (error) {
    expect((error as any).getStatus()).toBe(422);
    expect((error as any).getResponse()).toMatchObject({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'mail.vm-access' });
  }
  expect(messages).toHaveLength(0);
});

test('both VM mail contracts propagate SMTP failure without success response', async () => {
  const { alias, canonical, mail } = fixture();
  const failure = new Error('Mock SMTP failure');
  mail.sendMail = mock(async () => { throw failure; });
  await expect(alias.sendVmAccess(body)).rejects.toBe(failure);
  await expect(canonical.vmAccess({ platformContext: context }, body)).rejects.toBe(failure);
});
