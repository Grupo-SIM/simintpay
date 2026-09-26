import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Prisma } from '@prisma/client';

export type ProvenUser = {
  id: string; name: string; email: string; cpf: string | null; cnpj: string | null;
  domUserId: string | null; role: 'USER' | 'ADMIN'; isActive: boolean;
  clientStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  isCompany: boolean; source: string;
};

function copyValue(raw: string): string | null {
  if (raw === '\\N') return null;
  return raw.replace(/\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|[btnrfv\\])/g, (_, escape: string) => {
    const chars: Record<string, string> = { b: '\b', t: '\t', n: '\n', r: '\r', f: '\f', v: '\v', '\\': '\\' };
    return chars[escape] ?? String.fromCharCode(parseInt(escape.startsWith('x') ? escape.slice(1) : escape,
      escape.startsWith('x') ? 16 : 8));
  });
}

export function provenUser(row: Record<string, string | null>, source: string): ProvenUser {
  const email = row.email?.trim().toLowerCase();
  if (!row.id || !row.name?.trim() || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('Cadastro comprovado contém identidade incompleta.');
  if (row.role && !['USER', 'ADMIN'].includes(row.role)) throw new Error('Perfil desconhecido no backup.');
  if (row.clientStatus && !['PENDING', 'APPROVED', 'REJECTED'].includes(row.clientStatus))
    throw new Error('Status de cliente desconhecido no backup.');
  for (const [field, length] of [['cpf', 11], ['cnpj', 14]] as const) {
    if (row[field] && row[field]!.replace(/\D/g, '').length !== length)
      throw new Error(`Documento inválido no cadastro comprovado: ${field}.`);
  }
  return { id: row.id, name: row.name.trim(), email,
    cpf: row.cpf ? row.cpf.replace(/\D/g, '') : null,
    cnpj: row.cnpj ? row.cnpj.replace(/\D/g, '') : null,
    domUserId: row.domUserId || null, role: row.role === 'ADMIN' ? 'ADMIN' : 'USER',
    isActive: row.isActive !== 'f' && row.isActive !== 'false',
    isCompany: row.isCompany === 't' || row.isCompany === 'true',
    clientStatus: row.clientStatus as ProvenUser['clientStatus'] || null, source };
}

/** Reads data only; never executes SQL or imports sessions/passwords/tokens. */
export async function usersFromBackup(path: string): Promise<ProvenUser[]> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const users: ProvenUser[] = [];
  let columns: string[] | null = null;
  let found = false;
  try {
    for await (const line of lines) {
      if (!columns) {
        const match = /^COPY (?:public\.)?"User" \((.+)\) FROM stdin;$/.exec(line);
        if (match) { columns = match[1].split(', ').map(c => c.replace(/^"|"$/g, '')); found = true; }
        continue;
      }
      if (line === '\\.') { columns = null; continue; }
      const values = line.split('\t');
      if (values.length !== columns.length) throw new Error('Linha COPY User inválida no backup.');
      const row = Object.fromEntries(columns.map((c, i) => [c, copyValue(values[i])]));
      if (row.isPurged === 't' || row.isPurged === 'true') continue;
      users.push(provenUser(row, 'BACKUP_USER'));
    }
    if (columns) throw new Error('Backup truncado durante COPY User.');
    if (!found) throw new Error('Backup não contém COPY public."User"; formato suportado: pg_dump SQL texto.');
    return users;
  } finally { lines.close(); input.destroy(); }
}

export type LocalDomRow = {
  id: string; domTransactionId: string | null; domPaymentId: string | null;
  amount: Prisma.Decimal; netAmount: Prisma.Decimal | null; description: string | null;
  customerName: string | null; customerEmail: string | null;
  customerDocument: string | null; customerPhone: string | null;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

export function domPatch(row: LocalDomRow, response: unknown): Prisma.TransactionUpdateInput {
  const root = object(response);
  const data = object(root.data ?? root);
  const identities = [data.id, data.order_id, data.paymentId, data.cod_external, data.external_id]
    .filter((id): id is string => typeof id === 'string');
  if (![row.domTransactionId, row.domPaymentId].some(id => id && identities.includes(id)))
    throw new Error('Identidade DOM diverge da transação local.');
  const customer = object(data.customer);
  const patch: Prisma.TransactionUpdateInput = {};
  const fields = {
    customerName: string(customer.name, data.customer_name, data.client_name),
    customerEmail: string(customer.email, data.customer_email, data.client_email),
    customerDocument: string(customer.document, data.customer_document, data.client_document),
    customerPhone: string(customer.mobile_phone, customer.phone, data.customer_phone, data.client_phone),
    description: string(data.product_first, data.description),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (!row[key as keyof LocalDomRow] && value) Object.assign(patch, { [key]: value });
  }
  // A unidade deve ser comprovada pelo bruto. Sem correspondência exata, não
  // infere líquido; taxas DOM não necessariamente equivalem às taxas do vendedor.
  const rawAmount = data.amount;
  const rawNet = data.liquid_amount ?? data.amountWithoutAllFee ?? data.total_liquido;
  const money = (value: unknown) => (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0);
  if (row.netAmount == null && money(rawAmount) && money(rawNet)) {
    const gross = new Prisma.Decimal(String(rawAmount));
    const net = new Prisma.Decimal(String(rawNet));
    const divisor = gross.eq(row.amount) ? 1 : gross.div(100).eq(row.amount) ? 100 : null;
    if (divisor && row.amount.gt(0) && net.lte(gross) && net.div(divisor).decimalPlaces() <= 2)
      patch.netAmount = net.div(divisor);
  }
  return patch;
}

/** Only known read endpoint; no login, account creation or remote updates. */
export async function readDomDetail(id: string, token: string): Promise<unknown> {
  const base = process.env.DOM_REAL_API_URL ?? 'https://apiv3.dompagamentos.com.br/checkout/production';
  const url = new URL(`${base.replace(/\/$/, '')}/transactions/${encodeURIComponent(id)}`);
  if (url.protocol !== 'https:') throw new Error('DOM exige HTTPS para transmitir token.');
  const response = await fetch(url, { method: 'GET', redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'x-access-token': token, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`DOM HTTP ${response.status}`);
  return response.json();
}
