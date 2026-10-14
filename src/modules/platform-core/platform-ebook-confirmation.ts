import { BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { decryptPlatformSecret } from '../platform-integrations/platform-secrets';
import type { PlatformContext } from './platform-context.service';
import { unsupportedCapability } from './platform-adapters';
export type EbookConfirmation = { orderNumber?: string; status?: string; email?: string; store?: string };

export class PlatformEbookConfirmation {
  constructor(private readonly prisma: PrismaService) {}
  async forward(body: EbookConfirmation, context?: PlatformContext) {
    if (context && context.tag !== 'EBOOK') unsupportedCapability('ebook.payment-confirmation');
    if (!body?.orderNumber || !body?.status) throw new BadRequestException('orderNumber e status são obrigatórios');
    const platform = await this.prisma.platform.findUnique({ where: { tag: 'EBOOK' }, include: { owner: true, integrations: true } });
    if (!platform?.isActive || !platform.owner.isActive || platform.owner.isPurged || context && (context.id !== platform.id || context.ownerUserId !== platform.ownerUserId)) throw new ConflictException('Plataforma ou dono inativo/alterado');
    const backend = platform.integrations.find(row => row.key === 'BACKEND_URL')?.url;
    const credential = platform.integrations.find(row => row.key === 'INTERNAL_TOKEN');
    const token = context ? credential?.encryptedValue ? decryptPlatformSecret(credential.encryptedValue) : credential?.url : process.env.API_MACHINE_INTERNAL_TOKEN;
    if (!backend || !token) {
      if (context) unsupportedCapability('ebook.payment-confirmation.configuration');
      throw new InternalServerErrorException('BACK_EBOOK_URL/API_MACHINE_INTERNAL_TOKEN não configurados');
    }
    const response = await fetch(`${backend.replace(/\/+$/, '')}/webhook/payment-confirmation`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': token }, body: JSON.stringify({ orderNumber: body.orderNumber, status: body.status, email: body.email, store: body.store || 'ebook' }) });
    if (!response.ok) throw new BadRequestException(`Falha ao encaminhar webhook para back-ebook: ${response.status} ${await response.text()}`);
    return { status: 'ok', forwarded: true };
  }
}
