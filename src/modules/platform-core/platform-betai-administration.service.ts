import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PlatformContextService } from './platform-context.service';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';

export type BetaiAdministrationOperation = 'invoices' | 'run' | 'configuration' | 'saveConfiguration' | 'investors' | 'charge' | 'editInvoice' | 'deleteInvoice';
const operations: Record<BetaiAdministrationOperation, { method: string; path: string; body?: boolean }> = {
  invoices: { method: 'GET', path: 'invoices' }, run: { method: 'POST', path: 'run' },
  configuration: { method: 'GET', path: 'cobranca' }, saveConfiguration: { method: 'PUT', path: 'cobranca', body: true },
  investors: { method: 'GET', path: 'investors' }, charge: { method: 'POST', path: 'cobrar', body: true },
  editInvoice: { method: 'PATCH', path: 'invoices', body: true }, deleteInvoice: { method: 'DELETE', path: 'invoices' },
};

/** External business integration. Legacy opaque JSON stays confined to inventoried aliases. */
@Injectable()
export class PlatformBetaiAdministrationService {
  constructor(private readonly contexts: PlatformContextService) {}
  async legacy(operation: BetaiAdministrationOperation, input: { body?: unknown; id?: string; query?: string } = {}) {
    await this.contexts.resolve('BETAI');
    const base = String(getPlatformIntegrationValue('BETAI', 'BACKEND_URL') ?? '').replace(/\/+$/, '');
    if (!base) throw new InternalServerErrorException('BETAI_URL não configurado no api-machine');
    const spec = operations[operation];
    const suffix = operation === 'investors' ? `?q=${encodeURIComponent(input.query ?? '')}` : operation === 'editInvoice' || operation === 'deleteInvoice' ? `/${encodeURIComponent(input.id ?? '')}` : '';
    const headers = { ...(spec.body ? { 'Content-Type': 'application/json' } : {}), 'x-internal-token': process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '' };
    const response = await fetch(`${base}/internal/mensalidade/${spec.path}${suffix}`, {
      ...(spec.method === 'GET' ? {} : { method: spec.method }), headers, ...(spec.body ? { body: JSON.stringify(input.body ?? {}) } : {}),
    });
    if (!response.ok) throw new InternalServerErrorException(`Betai respondeu ${response.status}`);
    return response.json();
  }
}
