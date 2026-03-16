# PROMPT: Implementar Fluxo Completo de Saque — BFF API + Frontend

## Contexto

A BFF API (NestJS, Prisma, PostgreSQL) já está criada no diretório `admin-card-machine/bff-api` seguindo Clean Architecture e SOLID. O frontend Next.js está em `admin-card-machine/web`.

Preciso implementar o **fluxo completo de saque** igual ao que existe nos projetos **admin-renovada** (lado do usuário) e **admin-master** (lado do admin). O fluxo é:

```
[Usuário no frontend] → solicita saque → [BFF API] → propaga para [api-dom]
                                              ↓
                                        status: PENDING
                                              ↓
[Admin no frontend] → vê saque pendente → aprova (com comprovante) ou rejeita (com motivo)
                                              ↓
                                        [BFF API] → propaga para [api-dom]
                                              ↓
                                    wallet atualizada na api-dom + BFF
```

---

## PARTE 1: BFF API — Endpoints de Saque

### 1.1 Endpoints para o USUÁRIO

#### `GET /saques`
**Guard:** JwtAuthGuard (usuário autenticado)
**Query params:**
```typescript
{
  page?: number;      // default 1
  pageSize?: number;  // default 10
  status?: string;    // "PENDENTE" | "APROVADO" | "REJEITADO" | "PAGO" | "all"
}
```

**Fluxo interno:**
1. Extrai `userId` do JWT
2. Busca `WithdrawRequest` no banco BFF onde `userId = userId`, com paginação
3. Se filtro `status` informado e != "all", mapeia PT-BR → EN antes de filtrar:
   - `PENDENTE` → `PENDING`
   - `APROVADO` → `APPROVED`
   - `PAGO` → `COMPLETED`
   - `REJEITADO` → `REJECTED`
4. Ordena por `createdAt DESC`
5. Mapeia os resultados para o formato PT-BR na response

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "valor": 98.00,
      "valorBruto": 100.00,
      "taxa": 2.00,
      "status": "PENDENTE",
      "chavePix": "123.456.789-00",
      "comprovante": null,
      "motivoRejeicao": null,
      "criadoEm": "2026-02-14T10:30:00.000Z",
      "atualizadoEm": "2026-02-14T10:30:00.000Z",
      "usuario": {
        "nome": "João Silva",
        "email": "joao@email.com"
      }
    }
  ],
  "page": 1,
  "pageSize": 10,
  "total": 5
}
```

#### `POST /saques`
**Guard:** JwtAuthGuard
**Body:**
```json
{
  "valor": 150.00,
  "chavePix": "123.456.789-00"
}
```

**Validações (class-validator):**
- `valor`: `@IsNumber()`, `@Min(100, { message: 'O valor mínimo para saque é de R$ 100,00' })`
- `chavePix`: `@IsString()`, `@IsNotEmpty()`, `@Matches(/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'Chave PIX deve estar no formato CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00)' })`

**Fluxo interno:**
1. Extrai `userId` do JWT
2. Busca User no BFF com `wallet` e `domToken`
3. **Verifica saque pendente:** busca `WithdrawRequest` onde `userId = userId` E `status IN ('PENDING')` → se encontrar, retorna **409 Conflict**: `"Você já possui um saque pendente. Aguarde a aprovação antes de solicitar um novo."`
4. **Valida saldo:** busca Wallet do user
   - `availableBalance = wallet.balance - wallet.lockedBalance`
   - `netBalance = availableBalance * 0.91`
   - Se `valor > availableBalance - 2` → retorna **422**: `"Saldo insuficiente para saque (considere a taxa de R$ 2,00)"`
   - Se `valor < 100` → retorna **400**: `"O valor mínimo para saque é de R$ 100,00"`
5. **Propaga para api-dom:** `POST api-dom:3333/payments/withdraw` com:
   - Header: `x-access-token: <user.domToken>`
   - Body: `{ "amount": <valor>, "pixKey": "<chavePix>" }`
6. api-dom retorna: `{ message, requestId, fee: 2.00, netAmount, totalAmount }`
7. **Cria no BFF:**
   ```
   WithdrawRequest {
     userId,
     amount: netAmount (valor - taxa),
     grossAmount: valor,
     fee: 2.00,
     status: PENDING,
     pixKey: chavePix,
     domWithdrawId: requestId
   }
   ```
8. **Atualiza wallet no BFF** (espelhando api-dom):
   - `amountToLock = valor / 0.91`
   - `wallet.lockedBalance += amountToLock`
   - Incrementa `wallet.version`
9. **Cria BalanceLog:**
   ```
   {
     userId,
     action: 'WITHDRAW_REQUESTED',
     amount: -amountToLock,
     balanceBefore: wallet.balance (antes),
     balanceAfter: wallet.balance (não muda),
     lockedBefore: wallet.lockedBalance (antes),
     lockedAfter: wallet.lockedBalance (depois),
     source: 'WITHDRAW',
     description: 'Solicitação de saque'
   }
   ```
10. **Invalida cache Redis:** `DEL wallet:${userId}`

**Response 201:**
```json
{
  "data": {
    "id": "uuid",
    "valor": 148.00,
    "valorBruto": 150.00,
    "taxa": 2.00,
    "status": "PENDENTE",
    "chavePix": "123.456.789-00"
  },
  "message": "Saque solicitado com sucesso"
}
```

**Erros:**
- **400**: Valor mínimo R$ 100,00
- **409**: Saque pendente existente
- **422**: Saldo insuficiente

#### `GET /saques/verificar-pendente`
**Guard:** JwtAuthGuard

**Fluxo:** Busca `WithdrawRequest` onde `userId = userId` E `status = 'PENDING'`. Retorna boolean.

**Response 200:**
```json
{
  "data": {
    "temPendente": true,
    "saquePendente": {
      "id": "uuid",
      "valor": 148.00,
      "valorBruto": 150.00,
      "criadoEm": "ISO date"
    }
  }
}
```

---

### 1.2 Endpoints para o ADMIN

Todos os endpoints admin requerem `@Roles('ADMIN')` além de `JwtAuthGuard`.

#### `GET /admin/saques`
**Guard:** JwtAuthGuard + RolesGuard (ADMIN)
**Query params:**
```typescript
{
  page?: number;      // default 1
  limit?: number;     // default 10
  search?: string;    // busca por ID, nome ou email do usuário
  status?: string;    // "PENDING" | "COMPLETED" | "FAILED" | "APPROVED" | "all"
  dateRange?: string; // formato "YYYY-MM-DD,YYYY-MM-DD" (início,fim)
}
```

**Fluxo interno:**
1. Busca TODOS os `WithdrawRequest` (de todos os users) com filtros
2. Faz JOIN com User para ter `user.name` e `user.email`
3. Se `search` informado: filtra por `id CONTAINS search` OU `user.name CONTAINS search` OU `user.email CONTAINS search` (case insensitive)
4. Se `status` informado e != "all": filtra por status
5. Se `dateRange` informado: filtra por `createdAt BETWEEN dataInicio AND dataFim`
6. Ordena por `createdAt DESC`

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "uuid",
      "amount": 148.00,
      "grossAmount": 150.00,
      "fee": "2.00",
      "status": "PENDING",
      "pixKey": "123.456.789-00",
      "receiptImage": null,
      "rejectionReason": null,
      "createdAt": "2026-02-14T10:30:00.000Z",
      "updatedAt": "2026-02-14T10:30:00.000Z",
      "user": {
        "name": "João Silva",
        "email": "joao@email.com"
      }
    }
  ],
  "meta": {
    "currentPage": 1,
    "itemsPerPage": 10,
    "totalItems": 25,
    "totalPages": 3
  }
}
```

**IMPORTANTE:** O admin-master usa `meta` com `currentPage/itemsPerPage/totalItems/totalPages` (diferente do formato `page/pageSize/total` do lado do usuário). Manter esta estrutura para compatibilidade.

#### `GET /admin/saques/estatisticas`
**Guard:** JwtAuthGuard + RolesGuard (ADMIN)

**Response 200:**
```json
{
  "data": {
    "totalPendingRequests": 5,
    "pendingWithdrawAmount": 2500.00,
    "totalApprovedToday": 3,
    "totalApprovedAmount": 1500.00,
    "totalRejectedToday": 1
  }
}
```

#### `GET /admin/saques/:id`
**Guard:** JwtAuthGuard + RolesGuard (ADMIN)

**Response 200:**
```json
{
  "data": {
    "id": "uuid",
    "userId": "uuid",
    "amount": 148.00,
    "grossAmount": 150.00,
    "fee": "2.00",
    "status": "PENDING",
    "pixKey": "123.456.789-00",
    "receiptImage": null,
    "rejectionReason": null,
    "createdAt": "2026-02-14T10:30:00.000Z",
    "updatedAt": "2026-02-14T10:30:00.000Z",
    "user": {
      "name": "João Silva",
      "email": "joao@email.com"
    }
  }
}
```

#### `POST /admin/saques/:id/aprovar`
**Guard:** JwtAuthGuard + RolesGuard (ADMIN)
**Body:**
```json
{
  "receiptImage": "https://storage.example.com/comprovante-abc123.jpg"
}
```

**Validações:**
- `receiptImage`: `@IsString()`, `@IsNotEmpty({ message: 'Comprovante de transferência é obrigatório para aprovar o saque' })`, `@IsUrl({}, { message: 'URL do comprovante inválida' })`

**Fluxo interno:**
1. Busca `WithdrawRequest` por ID, inclui User com wallet
2. Valida `status === 'PENDING' || status === 'APPROVED'` → senão **400**: `"Saque não pode ser aprovado neste status"`
3. **Propaga para api-dom:** `POST api-dom:3333/payments/<domWithdrawId>/approve` com:
   - Header: `x-access-token: MASTER_KEY_DOM_API`
   - Body: `{ "receiptImage": "<receiptImage>" }`
4. **Atualiza no BFF:**
   ```
   WithdrawRequest.status = 'APPROVED'
   WithdrawRequest.receiptImage = receiptImage
   ```
5. **Atualiza wallet no BFF** (espelhando api-dom):
   - `totalAmountLiquido = withdraw.amount + withdraw.fee` (netAmount + taxa)
   - `amountLockedBruto = totalAmountLiquido / 0.91`
   - `wallet.balance -= amountLockedBruto`
   - `wallet.lockedBalance -= amountLockedBruto`
   - Incrementa `wallet.version`
6. **Cria BalanceLog:**
   ```
   {
     userId,
     action: 'WITHDRAW_APPROVED',
     amount: -amountLockedBruto,
     balanceBefore, balanceAfter,
     lockedBefore, lockedAfter,
     source: 'WITHDRAW',
     description: 'Saque aprovado pelo admin'
   }
   ```
7. **Invalida caches Redis:** `DEL wallet:${userId}`, `DEL saques:${userId}:*`

**Response 200:**
```json
{
  "data": {
    "id": "uuid",
    "status": "APPROVED",
    "receiptImage": "https://..."
  },
  "message": "Saque aprovado com sucesso"
}
```

#### `POST /admin/saques/:id/rejeitar`
**Guard:** JwtAuthGuard + RolesGuard (ADMIN)
**Body:**
```json
{
  "rejectionReason": "Dados inconsistentes na chave PIX"
}
```

**Validações:**
- `rejectionReason`: `@IsString()`, `@IsNotEmpty({ message: 'Motivo da rejeição é obrigatório' })`, `@MinLength(5, { message: 'Motivo deve ter no mínimo 5 caracteres' })`

**Fluxo interno:**
1. Busca `WithdrawRequest` por ID, inclui User com wallet
2. Valida `status === 'PENDING' || status === 'APPROVED'` → senão **400**: `"Saque não pode ser rejeitado neste status"`
3. **Propaga para api-dom:** `POST api-dom:3333/payments/<domWithdrawId>/reject` com:
   - Header: `x-access-token: MASTER_KEY_DOM_API`
   - Body: `{ "rejectionReason": "<rejectionReason>" }`
4. **Atualiza no BFF:**
   ```
   WithdrawRequest.status = 'REJECTED'
   WithdrawRequest.rejectionReason = rejectionReason
   ```
5. **Devolve saldo:** (api-dom já faz isso, espelhar no BFF)
   - `amountLockedBruto = (withdraw.amount + withdraw.fee) / 0.91`
   - `amountToUnlock = MIN(amountLockedBruto, wallet.lockedBalance)`
   - `wallet.lockedBalance -= amountToUnlock`
   - Incrementa `wallet.version`
6. **Cria BalanceLog:**
   ```
   {
     userId,
     action: 'WITHDRAW_REJECTED',
     amount: +amountToUnlock (positivo, devolvendo),
     lockedBefore, lockedAfter,
     source: 'WITHDRAW',
     description: 'Saque rejeitado: <rejectionReason>'
   }
   ```
7. **Invalida caches Redis**

**Response 200:**
```json
{
  "data": {
    "id": "uuid",
    "status": "REJECTED",
    "rejectionReason": "Dados inconsistentes na chave PIX"
  },
  "message": "Saque rejeitado com sucesso. Valor devolvido à carteira do usuário."
}
```

#### `POST /admin/saques/:id/comprovante`
**Guard:** JwtAuthGuard + RolesGuard (ADMIN)
**Body:**
```json
{
  "receiptImage": "https://storage.example.com/comprovante.jpg"
}
```

**Fluxo:** Apenas atualiza o campo `receiptImage` do WithdrawRequest. Não muda status nem wallet. Permite adicionar ou remover (string vazia) comprovante independente da aprovação.

**Response 200:**
```json
{
  "data": {
    "id": "uuid",
    "receiptImage": "https://..."
  },
  "message": "Comprovante atualizado com sucesso"
}
```

#### `POST /admin/upload/imagem`
**Guard:** JwtAuthGuard + RolesGuard (ADMIN)
**Content-Type:** `multipart/form-data`
**Body:** FormData com campo `image` (arquivo de imagem)

**Fluxo:**
1. Valida arquivo: tipo `image/jpeg`, `image/png`, `image/webp`; tamanho max 5MB
2. Faz upload para storage (S3, Cloudflare R2, ou local em dev)
3. Retorna URL pública

**Response 200:**
```json
{
  "data": {
    "url": "https://storage.example.com/uploads/abc123.jpg"
  }
}
```

**NOTA:** Na api-dom atual, o upload vai para `POST api-dom:3333/upload/image`. A BFF pode fazer proxy para esse endpoint ou implementar storage próprio. Se fizer proxy:
- Forward o FormData para `POST api-dom:3333/upload/image` com header `x-access-token: MASTER_KEY_DOM_API`
- api-dom usa S3-compatible storage (Storj) e retorna `{ url: "..." }`

---

### 1.3 Endpoint de Resumo Financeiro (usado na página de saque)

#### `GET /wallet/resumo-financeiro`
**Guard:** JwtAuthGuard

**Fluxo interno:**
1. Busca wallet do user no BFF
2. Calcula:
   - `availableBalance = wallet.balance - wallet.lockedBalance`
   - `netBalance = availableBalance * 0.91`
   - `netLockedBalance = wallet.lockedBalance * 0.91`
3. Busca soma de `WithdrawRequest` onde `status = 'PENDING'` e `userId = userId`
4. Opcionalmente enriquece com api-dom: `GET api-dom:3333/payments/summary` com `x-access-token: <domToken>`

**Response 200:**
```json
{
  "data": {
    "availableBalance": 1300.00,
    "netBalance": 1183.00,
    "pendingWithdraws": 150.00,
    "lockedBalance": 200.00,
    "netLockedBalance": 182.00,
    "wallet": {
      "id": "uuid",
      "userId": "uuid",
      "version": 5,
      "updatedAt": "2026-02-14T10:30:00.000Z",
      "lastWithDrawDate": "2026-02-10T15:00:00.000Z"
    }
  }
}
```

---

## PARTE 2: Prisma Schema — Alterações Necessárias

Verificar se o schema do BFF já tem estes campos. Se não, adicionar:

```prisma
enum WithdrawStatus {
  PENDING
  APPROVED
  COMPLETED
  REJECTED    // ← Confirmar que REJECTED existe (o prompt original tinha REJECTED mas não FAILED)
}

model WithdrawRequest {
  id              String         @id @default(uuid())
  userId          String
  user            User           @relation(fields: [userId], references: [id])
  amount          Decimal        @db.Decimal(12, 2) // Valor líquido (valor - taxa)
  grossAmount     Decimal        @db.Decimal(12, 2) // Valor solicitado pelo user
  fee             Decimal        @default(2.00) @db.Decimal(12, 2) // Taxa fixa R$ 2,00
  status          WithdrawStatus @default(PENDING)
  pixKey          String
  receiptImage    String?        // URL do comprovante (adicionado pelo admin)
  rejectionReason String?        // Motivo da rejeição (adicionado pelo admin)

  // Referência na api-dom
  domWithdrawId   String?        @unique

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([userId])
  @@index([status])
  @@index([createdAt])
}
```

Também verificar se o model `Wallet` tem o campo `lastWithDrawDate`:
```prisma
model Wallet {
  // ... campos existentes ...
  lastWithDrawDate DateTime?   // ← Adicionar se não existir
}
```

---

## PARTE 3: Use Cases (Clean Architecture)

### 3.1 Use Cases do Usuário

#### `RequestWithdrawUseCase`
```typescript
// application/use-cases/withdraw/request-withdraw.use-case.ts

@Injectable()
export class RequestWithdrawUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY) private withdrawRepo: IWithdrawRepository,
    @Inject(WALLET_REPOSITORY) private walletRepo: IWalletRepository,
    @Inject(BALANCE_LOG_REPOSITORY) private balanceLogRepo: IBalanceLogRepository,
    @Inject(PAYMENT_GATEWAY) private paymentGateway: IPaymentGateway,
    @Inject(CACHE_SERVICE) private cache: ICacheService,
  ) {}

  async execute(userId: string, dto: RequestWithdrawDto): Promise<WithdrawResponse> {
    // 1. Verificar saque pendente
    const pending = await this.withdrawRepo.findPendingByUserId(userId);
    if (pending) throw new DuplicateWithdrawError();

    // 2. Buscar wallet e validar saldo
    const wallet = await this.walletRepo.findByUserId(userId);
    if (!wallet) throw new EntityNotFoundError('Wallet');

    const availableBalance = Number(wallet.balance) - Number(wallet.lockedBalance);
    if (dto.valor > availableBalance - 2) {
      throw new InsufficientBalanceError();
    }

    // 3. Propagar para api-dom
    const domResult = await this.paymentGateway.requestWithdraw(userId, {
      amount: dto.valor,
      pixKey: dto.chavePix,
    });

    // 4. Criar no BFF (transação atômica)
    const result = await this.withdrawRepo.createWithWalletUpdate({
      userId,
      amount: domResult.netAmount,
      grossAmount: dto.valor,
      fee: domResult.fee,
      pixKey: dto.chavePix,
      domWithdrawId: domResult.requestId,
      walletId: wallet.id,
      amountToLock: dto.valor / 0.91,
      currentWalletVersion: wallet.version,
    });

    // 5. Criar BalanceLog
    await this.balanceLogRepo.create({ /* ... */ });

    // 6. Invalidar cache
    await this.cache.delete(`wallet:${userId}`);

    return result;
  }
}
```

#### `ListWithdrawalsUseCase`
```typescript
// application/use-cases/withdraw/list-withdrawals.use-case.ts

@Injectable()
export class ListWithdrawalsUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY) private withdrawRepo: IWithdrawRepository,
  ) {}

  async execute(userId: string, query: ListWithdrawalsQuery): Promise<PaginatedResponse<WithdrawResponse>> {
    const statusMap: Record<string, string> = {
      'PENDENTE': 'PENDING',
      'APROVADO': 'APPROVED',
      'PAGO': 'COMPLETED',
      'REJEITADO': 'REJECTED',
    };

    const dbStatus = query.status && query.status !== 'all'
      ? statusMap[query.status]
      : undefined;

    const result = await this.withdrawRepo.findByUserId(userId, {
      page: query.page || 1,
      pageSize: query.pageSize || 10,
      status: dbStatus,
    });

    // Mapear para PT-BR na response
    const reverseStatusMap: Record<string, string> = {
      'PENDING': 'PENDENTE',
      'APPROVED': 'APROVADO',
      'COMPLETED': 'PAGO',
      'REJECTED': 'REJEITADO',
    };

    return {
      data: result.data.map(w => ({
        id: w.id,
        valor: Number(w.amount),
        valorBruto: Number(w.grossAmount),
        taxa: Number(w.fee),
        status: reverseStatusMap[w.status] || w.status,
        chavePix: w.pixKey,
        comprovante: w.receiptImage || null,
        motivoRejeicao: w.rejectionReason || null,
        criadoEm: w.createdAt.toISOString(),
        atualizadoEm: w.updatedAt.toISOString(),
        usuario: {
          nome: w.user.name,
          email: w.user.email,
        },
      })),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }
}
```

#### `CheckPendingWithdrawUseCase`
```typescript
@Injectable()
export class CheckPendingWithdrawUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY) private withdrawRepo: IWithdrawRepository,
  ) {}

  async execute(userId: string) {
    const pending = await this.withdrawRepo.findPendingByUserId(userId);
    return {
      temPendente: !!pending,
      saquePendente: pending ? {
        id: pending.id,
        valor: Number(pending.amount),
        valorBruto: Number(pending.grossAmount),
        criadoEm: pending.createdAt.toISOString(),
      } : null,
    };
  }
}
```

### 3.2 Use Cases do Admin

#### `AdminListWithdrawalsUseCase`
```typescript
@Injectable()
export class AdminListWithdrawalsUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY) private withdrawRepo: IWithdrawRepository,
  ) {}

  async execute(query: AdminListWithdrawalsQuery) {
    // Busca todos os saques com filtros (search, status, dateRange)
    // JOIN com User para obter name e email
    // Retorna no formato { data: [...], meta: { currentPage, itemsPerPage, totalItems, totalPages } }
  }
}
```

#### `ApproveWithdrawUseCase`
```typescript
@Injectable()
export class ApproveWithdrawUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY) private withdrawRepo: IWithdrawRepository,
    @Inject(WALLET_REPOSITORY) private walletRepo: IWalletRepository,
    @Inject(BALANCE_LOG_REPOSITORY) private balanceLogRepo: IBalanceLogRepository,
    @Inject(PAYMENT_GATEWAY) private paymentGateway: IPaymentGateway,
    @Inject(CACHE_SERVICE) private cache: ICacheService,
  ) {}

  async execute(withdrawId: string, dto: ApproveWithdrawDto) {
    const withdraw = await this.withdrawRepo.findByIdWithUser(withdrawId);
    if (!withdraw) throw new EntityNotFoundError('WithdrawRequest');
    if (withdraw.status !== 'PENDING' && withdraw.status !== 'APPROVED') {
      throw new InvalidStatusTransitionError(withdraw.status, 'APPROVED');
    }

    // Propagar para api-dom
    await this.paymentGateway.approveWithdraw(withdraw.domWithdrawId, dto.receiptImage);

    // Atualizar no BFF (transação atômica)
    const totalAmountLiquido = Number(withdraw.amount) + Number(withdraw.fee);
    const amountLockedBruto = totalAmountLiquido / 0.91;

    await this.withdrawRepo.approveWithWalletUpdate({
      withdrawId,
      receiptImage: dto.receiptImage,
      userId: withdraw.userId,
      amountToDeduct: amountLockedBruto,
      currentWalletVersion: withdraw.user.wallet.version,
    });

    // BalanceLog + Invalidar cache
    await this.balanceLogRepo.create({ /* ... */ });
    await this.cache.delete(`wallet:${withdraw.userId}`);
  }
}
```

#### `RejectWithdrawUseCase`
```typescript
@Injectable()
export class RejectWithdrawUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY) private withdrawRepo: IWithdrawRepository,
    @Inject(WALLET_REPOSITORY) private walletRepo: IWalletRepository,
    @Inject(BALANCE_LOG_REPOSITORY) private balanceLogRepo: IBalanceLogRepository,
    @Inject(PAYMENT_GATEWAY) private paymentGateway: IPaymentGateway,
    @Inject(CACHE_SERVICE) private cache: ICacheService,
  ) {}

  async execute(withdrawId: string, dto: RejectWithdrawDto) {
    const withdraw = await this.withdrawRepo.findByIdWithUser(withdrawId);
    if (!withdraw) throw new EntityNotFoundError('WithdrawRequest');
    if (withdraw.status !== 'PENDING' && withdraw.status !== 'APPROVED') {
      throw new InvalidStatusTransitionError(withdraw.status, 'REJECTED');
    }

    // Propagar para api-dom
    await this.paymentGateway.rejectWithdraw(withdraw.domWithdrawId, dto.rejectionReason);

    // Devolver locked balance
    const amountLockedBruto = (Number(withdraw.amount) + Number(withdraw.fee)) / 0.91;
    const currentLocked = Number(withdraw.user.wallet.lockedBalance);
    const amountToUnlock = Math.min(amountLockedBruto, currentLocked);

    await this.withdrawRepo.rejectWithWalletUpdate({
      withdrawId,
      rejectionReason: dto.rejectionReason,
      userId: withdraw.userId,
      amountToUnlock,
      currentWalletVersion: withdraw.user.wallet.version,
    });

    // BalanceLog + Invalidar cache
    await this.balanceLogRepo.create({ /* ... */ });
    await this.cache.delete(`wallet:${withdraw.userId}`);
  }
}
```

#### `GetWithdrawStatsUseCase`
```typescript
@Injectable()
export class GetWithdrawStatsUseCase {
  constructor(
    @Inject(WITHDRAW_REPOSITORY) private withdrawRepo: IWithdrawRepository,
  ) {}

  async execute() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return {
      totalPendingRequests: await this.withdrawRepo.countByStatus('PENDING'),
      pendingWithdrawAmount: await this.withdrawRepo.sumAmountByStatus('PENDING'),
      totalApprovedToday: await this.withdrawRepo.countByStatusAndDateFrom('APPROVED', today),
      totalApprovedAmount: await this.withdrawRepo.sumAmountByStatusAndDateFrom('APPROVED', today),
      totalRejectedToday: await this.withdrawRepo.countByStatusAndDateFrom('REJECTED', today),
    };
  }
}
```

---

## PARTE 4: Repository Interface

```typescript
// core/repositories/withdraw.repository.interface.ts

export const WITHDRAW_REPOSITORY = Symbol('IWithdrawRepository');

export interface IWithdrawRepository {
  findByIdWithUser(id: string): Promise<WithdrawWithUser | null>;
  findPendingByUserId(userId: string): Promise<WithdrawRequestEntity | null>;
  findByUserId(userId: string, opts: PaginationOpts & { status?: string }): Promise<PaginatedResult<WithdrawWithUser>>;
  findAll(opts: AdminWithdrawFilters): Promise<PaginatedResult<WithdrawWithUser>>;

  createWithWalletUpdate(data: CreateWithdrawData): Promise<WithdrawRequestEntity>;
  approveWithWalletUpdate(data: ApproveWithdrawData): Promise<void>;
  rejectWithWalletUpdate(data: RejectWithdrawData): Promise<void>;
  updateReceipt(id: string, receiptImage: string): Promise<void>;

  countByStatus(status: string): Promise<number>;
  sumAmountByStatus(status: string): Promise<number>;
  countByStatusAndDateFrom(status: string, from: Date): Promise<number>;
  sumAmountByStatusAndDateFrom(status: string, from: Date): Promise<number>;
}
```

**A implementação Prisma** (`prisma-withdraw.repository.ts`) deve usar `prisma.$transaction()` nos métodos que alteram wallet + withdraw juntos, garantindo atomicidade. Usar optimistic locking no wallet:

```typescript
// Dentro do $transaction:
const updatedWallet = await tx.wallet.updateMany({
  where: { userId, version: currentWalletVersion },
  data: {
    lockedBalance: { increment: amountToLock },
    version: { increment: 1 },
  },
});

if (updatedWallet.count === 0) {
  throw new Error('Wallet version conflict — retry');
}
```

---

## PARTE 5: Controllers

### 5.1 WithdrawController (Usuário)

```typescript
// presentation/controllers/withdraw.controller.ts

@Controller('saques')
@UseGuards(JwtAuthGuard)
export class WithdrawController {
  constructor(
    private readonly requestWithdraw: RequestWithdrawUseCase,
    private readonly listWithdrawals: ListWithdrawalsUseCase,
    private readonly checkPending: CheckPendingWithdrawUseCase,
    private readonly getFinancialSummary: GetFinancialSummaryUseCase,
  ) {}

  @Get()
  async list(@CurrentUser() user: UserPayload, @Query() query: ListWithdrawalsQueryDto) {
    return this.listWithdrawals.execute(user.sub, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: UserPayload, @Body() dto: RequestWithdrawDto) {
    const result = await this.requestWithdraw.execute(user.sub, dto);
    return { data: result, message: 'Saque solicitado com sucesso' };
  }

  @Get('verificar-pendente')
  async checkPendingWithdraw(@CurrentUser() user: UserPayload) {
    const result = await this.checkPending.execute(user.sub);
    return { data: result };
  }
}
```

### 5.2 AdminWithdrawController (Admin)

```typescript
// presentation/controllers/admin-withdraw.controller.ts

@Controller('admin/saques')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminWithdrawController {
  constructor(
    private readonly adminListWithdrawals: AdminListWithdrawalsUseCase,
    private readonly approveWithdraw: ApproveWithdrawUseCase,
    private readonly rejectWithdraw: RejectWithdrawUseCase,
    private readonly getStats: GetWithdrawStatsUseCase,
    private readonly updateReceipt: UpdateReceiptUseCase,
  ) {}

  @Get()
  async list(@Query() query: AdminListWithdrawalsQueryDto) {
    return this.adminListWithdrawals.execute(query);
  }

  @Get('estatisticas')
  async stats() {
    const result = await this.getStats.execute();
    return { data: result };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    // ...
  }

  @Post(':id/aprovar')
  async approve(@Param('id') id: string, @Body() dto: ApproveWithdrawDto) {
    await this.approveWithdraw.execute(id, dto);
    return { message: 'Saque aprovado com sucesso' };
  }

  @Post(':id/rejeitar')
  async reject(@Param('id') id: string, @Body() dto: RejectWithdrawDto) {
    await this.rejectWithdraw.execute(id, dto);
    return { message: 'Saque rejeitado com sucesso. Valor devolvido à carteira do usuário.' };
  }

  @Post(':id/comprovante')
  async receipt(@Param('id') id: string, @Body() dto: UpdateReceiptDto) {
    await this.updateReceipt.execute(id, dto.receiptImage);
    return { message: 'Comprovante atualizado com sucesso' };
  }
}
```

---

## PARTE 6: Payment Gateway Interface — Métodos de Saque

Adicionar ao `IPaymentGateway` (ou criar `IWithdrawGateway` seguindo ISP):

```typescript
// core/services/withdraw-gateway.interface.ts

export const WITHDRAW_GATEWAY = Symbol('IWithdrawGateway');

export interface IWithdrawGateway {
  requestWithdraw(userId: string, data: { amount: number; pixKey: string }): Promise<{
    requestId: string;
    fee: number;
    netAmount: number;
    totalAmount: number;
  }>;

  approveWithdraw(domWithdrawId: string, receiptImage: string): Promise<void>;
  rejectWithdraw(domWithdrawId: string, rejectionReason: string): Promise<void>;

  uploadImage(file: Buffer, filename: string): Promise<{ url: string }>;
}
```

**Implementação** (`api-dom-withdraw.gateway.ts`):

```typescript
@Injectable()
export class ApiDomWithdrawGateway implements IWithdrawGateway {
  constructor(
    private readonly apiDomClient: ApiDomClient,
    @Inject(USER_REPOSITORY) private userRepo: IUserRepository,
  ) {}

  async requestWithdraw(userId: string, data: { amount: number; pixKey: string }) {
    const user = await this.userRepo.findById(userId);
    // Chama api-dom com domToken do user
    return this.apiDomClient.post('/payments/withdraw', data, {
      headers: { 'x-access-token': user.domToken },
    });
  }

  async approveWithdraw(domWithdrawId: string, receiptImage: string) {
    // Chama api-dom com MASTER_KEY
    return this.apiDomClient.post(`/payments/${domWithdrawId}/approve`,
      { receiptImage },
      { headers: { 'x-access-token': process.env.API_DOM_MASTER_KEY } },
    );
  }

  async rejectWithdraw(domWithdrawId: string, rejectionReason: string) {
    return this.apiDomClient.post(`/payments/${domWithdrawId}/reject`,
      { rejectionReason },
      { headers: { 'x-access-token': process.env.API_DOM_MASTER_KEY } },
    );
  }

  async uploadImage(file: Buffer, filename: string) {
    const formData = new FormData();
    formData.append('image', new Blob([file]), filename);
    return this.apiDomClient.post('/upload/image', formData, {
      headers: { 'x-access-token': process.env.API_DOM_MASTER_KEY },
    });
  }
}
```

---

## PARTE 7: Frontend — Página de Saque do USUÁRIO

### Arquivo: `web/src/app/(dashboard)/saque/page.tsx`

Implementar baseado no fluxo do admin-renovada. A página deve ter:

### 7.1 Estado

```typescript
const [financialSummary, setFinancialSummary] = useState<FinancialSummary | null>(null);
const [loading, setLoading] = useState(true);
const [withdrawals, setWithdrawals] = useState<Saque[]>([]);
const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0 });
const [activeTab, setActiveTab] = useState<'summary' | 'history'>('summary');
const [isModalOpen, setIsModalOpen] = useState(false);
const [withdrawalAmount, setWithdrawalAmount] = useState('');
const [pixKey, setPixKey] = useState('');
const [isWithdrawing, setIsWithdrawing] = useState(false);
const [hasPendingWithdrawal, setHasPendingWithdrawal] = useState(false);
const [pendingWithdrawal, setPendingWithdrawal] = useState<Saque | null>(null);
const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
const [selectedReceiptImage, setSelectedReceiptImage] = useState('');
```

### 7.2 Tipos

Atualizar `web/src/features/saque/types/saque.types.ts`:

```typescript
export type SaqueStatus = 'PENDENTE' | 'APROVADO' | 'REJEITADO' | 'PAGO';

export type Saque = {
  id: string;
  valor: number;
  valorBruto: number;
  taxa: number;
  status: SaqueStatus;
  chavePix: string;
  comprovante: string | null;
  motivoRejeicao: string | null;
  criadoEm: string;
  atualizadoEm: string;
  usuario: {
    nome: string;
    email: string;
  };
};

export type FinancialSummary = {
  availableBalance: number;
  netBalance: number;
  pendingWithdraws: number;
  lockedBalance: number;
  netLockedBalance: number;
  wallet: {
    id: string;
    userId: string;
    version: number;
    updatedAt: string;
    lastWithDrawDate: string | null;
  };
};

export type CreateSaqueDto = {
  valor: number;
  chavePix: string;
};

export type ListSaquesQuery = {
  page?: number;
  pageSize?: number;
  status?: SaqueStatus | 'all';
};
```

### 7.3 Services

Atualizar `web/src/features/saque/services/saque.service.ts`:

```typescript
import { ApiClient } from '@/services/api/api.client';
import { PaginatedResponse } from '@/services/api/types';
import { Saque, CreateSaqueDto, FinancialSummary, ListSaquesQuery } from '../types/saque.types';

export async function listSaques(api: ApiClient, query: ListSaquesQuery): Promise<PaginatedResponse<Saque>> {
  return api.get('/saques', { query });
}

export async function createSaque(api: ApiClient, dto: CreateSaqueDto): Promise<{ data: Saque; message: string }> {
  return api.post('/saques', dto);
}

export async function getFinancialSummary(api: ApiClient): Promise<{ data: FinancialSummary }> {
  return api.get('/wallet/resumo-financeiro');
}

export async function checkPendingWithdraw(api: ApiClient): Promise<{ data: { temPendente: boolean; saquePendente: Saque | null } }> {
  return api.get('/saques/verificar-pendente');
}
```

### 7.4 Endpoints

Atualizar `web/src/services/api/endpoints.ts`:

```typescript
export const endpoints = {
  saque: {
    list: '/saques',
    create: '/saques',
    checkPending: '/saques/verificar-pendente',
  },
  wallet: {
    summary: '/wallet/resumo-financeiro',
    balance: '/wallet/saldo',
    statement: '/wallet/extrato',
  },
  transacoes: {
    list: '/transacoes',
  },
} as const;
```

### 7.5 Layout da Página

A página de saque deve ter:

**Header:** Título "Saque" + botão "Solicitar Saque" (desabilitado se tem saque pendente)

**Aba "Resumo" (default):**
- 3 cards:
  - **Saldo disponível**: `financialSummary.netBalance` formatado como BRL
  - **Saque em processo**: `financialSummary.pendingWithdraws` formatado como BRL
  - **Saldo em processamento**: `financialSummary.netLockedBalance` formatado como BRL
- Info da carteira:
  - Última atualização: `wallet.updatedAt`
  - Último saque: `wallet.lastWithDrawDate` ou "Nenhum saque realizado"
- Banner azul: "Atenção: As solicitações de saque são processadas em até 48 horas apenas em dias úteis."
- Se tem saque pendente: banner amarelo "Saque Pendente de Aprovação — Você possui um saque de R$ X,XX aguardando aprovação."

**Aba "Histórico de Saques":**
- Tabela com colunas: Data, Nome, Email, Valor, Chave PIX, Status (badge colorido), Comprovante
- Status badges:
  - PENDENTE → badge amarelo "Aguardando Aprovação"
  - APROVADO → badge azul "Aprovado - Processando"
  - PAGO → badge verde "Concluído"
  - REJEITADO → badge vermelho "Recusado" (com tooltip mostrando motivo se houver)
- Coluna Comprovante: se existe `comprovante` → botões "Ver" (abre modal) e "Baixar"; senão "Não disponível"
- Paginação: 10 itens por página

**Modal "Solicitar Saque":**
- Se tem saque pendente: aviso amarelo bloqueando
- Campo "Valor" (R$): input numérico, formatação automática (divisão por 100), borda vermelha se > availableBalance - 2
  - Helper: "Saldo disponível: R$ X,XX"
- Campo "PIX (CPF/CNPJ)": formatação automática (CPF se <=11 dígitos, CNPJ se >11)
- Texto info: "Será cobrada uma taxa de R$ 2,00 por saque"
- Texto vermelho: "O valor mínimo para saque deve ser de R$ 100,00"
- Botão "Confirmar" desabilitado quando:
  - `hasPendingWithdrawal`
  - `isWithdrawing`
  - `!withdrawalAmount || !pixKey`
  - `parseFloat(withdrawalAmount) < 100`
  - `parseFloat(withdrawalAmount) > availableBalance - 2`
- No submit: chama `POST /saques`, mostra toast de sucesso ou erro, fecha modal, refresh dados

**Modal de Comprovante:**
- Imagem fullscreen do comprovante
- Botão "Baixar" (download via fetch + createObjectURL)

### 7.6 Formatação de Valores

```typescript
// Formatação para input monetário (centavos → reais)
const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const raw = e.target.value.replace(/\D/g, '');
  const asNumber = parseInt(raw, 10);
  if (isNaN(asNumber)) {
    setWithdrawalAmount('');
    return;
  }
  setWithdrawalAmount((asNumber / 100).toFixed(2));
};

// Formatação de chave PIX (CPF/CNPJ)
const handlePixKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const raw = e.target.value.replace(/\D/g, '');
  if (raw.length <= 11) {
    // CPF: 000.000.000-00
    setPixKey(raw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'));
  } else {
    // CNPJ: 00.000.000/0000-00
    setPixKey(raw.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'));
  }
};

// Formatação BRL
const formatBRL = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};
```

---

## PARTE 8: Frontend — Página ADMIN de Gerenciamento de Saques

### Decisão: O admin ficará no MESMO frontend (admin-card-machine/web) ou em um frontend separado?

**Recomendação:** Criar as rotas admin dentro do mesmo frontend, protegidas por role. Adicionar ao layout da dashboard um menu "Admin" visível apenas para users com `role: ADMIN`.

### Rota: `/admin/saques`

**Arquivo:** `web/src/app/(dashboard)/admin/saques/page.tsx`

**Layout:**
- Título: "Gerenciamento de Saques"
- Filtros colapsáveis:
  - Campo de busca: "ID, nome ou e-mail..."
  - Dropdown de status: Todos, Pendente, Aprovado, Concluído, Recusado
- Tabela com colunas: Usuário (nome + email), Valor, Status (badge), Data, Chave PIX (truncada), Comprovante (badge "Disponível"/"Não disponível"), Ações ("Ver Detalhes")
- Paginação: 10 por página, Prev/Next

**Modal de Detalhes:**

Seções:
1. **Solicitante**: nome + email
2. **Status & Data**: badge status + data formatada
3. **Informações Financeiras**: valor solicitado + taxa + chave PIX
4. **Comprovante de Transferência**:
   - Se existe: imagem + botões "Baixar", "Alterar", "Remover"
   - Se não existe: área de drag-and-drop/upload
5. **Botões de Ação** (visíveis se status PENDING ou APPROVED):
   - "Recusar" → abre diálogo de confirmação com textarea para motivo (obrigatório)
   - "Concluir Saque" / "Finalizar Saque" → se já tem comprovante, aprova direto; senão, abre diálogo para upload de comprovante

**Fluxo de Aprovação:**
1. Admin clica "Concluir Saque"
2. Se já tem comprovante no saque: chama `POST /admin/saques/:id/aprovar` com `{ receiptImage: existingUrl }`
3. Se não tem comprovante: abre diálogo para upload
   - Admin seleciona/arrasta imagem
   - Frontend faz `POST /admin/upload/imagem` (FormData) → obtém URL
   - Frontend chama `POST /admin/saques/:id/aprovar` com `{ receiptImage: url }`
4. Toast sucesso, fecha modal, refresh lista

**Fluxo de Rejeição:**
1. Admin clica "Recusar"
2. Abre diálogo com textarea "Motivo da rejeição" (obrigatório, botão desabilitado se vazio)
3. Texto informativo: "O valor será retornado para a carteira do usuário."
4. Admin preenche motivo e confirma
5. Frontend chama `POST /admin/saques/:id/rejeitar` com `{ rejectionReason: motivo }`
6. Toast sucesso, fecha modal, refresh lista

### Services do Admin

```typescript
// web/src/features/admin/saques/services/admin-saque.service.ts

export async function listAdminSaques(api: ApiClient, query: AdminSaquesQuery) {
  return api.get('/admin/saques', { query });
}

export async function getWithdrawStats(api: ApiClient) {
  return api.get('/admin/saques/estatisticas');
}

export async function getWithdrawDetail(api: ApiClient, id: string) {
  return api.get(`/admin/saques/${id}`);
}

export async function approveWithdraw(api: ApiClient, id: string, receiptImage: string) {
  return api.post(`/admin/saques/${id}/aprovar`, { receiptImage });
}

export async function rejectWithdraw(api: ApiClient, id: string, rejectionReason: string) {
  return api.post(`/admin/saques/${id}/rejeitar`, { rejectionReason });
}

export async function updateReceipt(api: ApiClient, id: string, receiptImage: string) {
  return api.post(`/admin/saques/${id}/comprovante`, { receiptImage });
}

export async function uploadImage(api: ApiClient, file: File): Promise<{ data: { url: string } }> {
  const formData = new FormData();
  formData.append('image', file);
  return api.request({
    method: 'POST',
    path: '/admin/upload/imagem',
    body: formData,
    // Não setar Content-Type — o browser seta automaticamente com boundary
  });
}
```

---

## PARTE 9: Mapeamento de Endpoints api-dom Necessários

| BFF Endpoint | Método api-dom | Endpoint api-dom | Header | Body |
|---|---|---|---|---|
| `POST /saques` | POST | `/payments/withdraw` | `x-access-token: <domToken>` | `{ amount, pixKey }` |
| `GET /wallet/resumo-financeiro` | GET | `/payments/summary` | `x-access-token: <domToken>` | — |
| `POST /admin/saques/:id/aprovar` | POST | `/payments/<domWithdrawId>/approve` | `x-access-token: MASTER_KEY` | `{ receiptImage }` |
| `POST /admin/saques/:id/rejeitar` | POST | `/payments/<domWithdrawId>/reject` | `x-access-token: MASTER_KEY` | `{ rejectionReason }` |
| `POST /admin/upload/imagem` | POST | `/upload/image` | `x-access-token: MASTER_KEY` | FormData `{ image: File }` |
| `GET /saques` (listar) | GET | `/payments/withdrawals?page=N&limit=10` | `x-access-token: <domToken>` | — |

---

## PARTE 10: Regras de Negócio Críticas (Saque)

1. **Valor mínimo: R$ 100,00** — Validar no frontend E no backend
2. **Taxa fixa: R$ 2,00** — Deduzida do valor solicitado (user pede 150, recebe 148)
3. **Apenas 1 saque PENDING por vez** — Verificar antes de criar
4. **Saldo disponível para saque = (balance - lockedBalance) — taxa de R$ 2,00**
5. **Na admin-renovada, a validação usa availableBalance (não netBalance)** — Manter consistência
6. **Ao criar saque:** lock `valor / 0.91` na wallet (consistente com api-dom)
7. **Ao aprovar:** deduz `(amount + fee) / 0.91` do balance E do lockedBalance
8. **Ao rejeitar:** devolve `MIN((amount + fee) / 0.91, lockedBalance)` ao lockedBalance (desbloqueia)
9. **APPROVED status pode ser rejeitado ou finalizado** — Ambas ações são possíveis no admin-master
10. **Comprovante é obrigatório para aprovação** — Pode ser pré-anexado ou enviado no momento da aprovação
11. **Motivo é obrigatório para rejeição** — Mínimo 5 caracteres
12. **Optimistic locking:** Usar campo `version` da wallet em todas as operações
13. **Invalidar cache Redis** após qualquer operação de saque

---

## PARTE 11: Ordem de Implementação

1. **Schema Prisma** — Verificar/atualizar WithdrawRequest, adicionar lastWithDrawDate no Wallet, rodar migration
2. **Repository interface** — `IWithdrawRepository` com todos os métodos
3. **Prisma repository** — Implementação com $transaction e optimistic locking
4. **Withdraw gateway** — Interface + implementação api-dom
5. **Use cases usuário** — RequestWithdraw, ListWithdrawals, CheckPending
6. **Use cases admin** — AdminListWithdrawals, ApproveWithdraw, RejectWithdraw, GetStats, UpdateReceipt
7. **DTOs** — Validação com class-validator
8. **Controllers** — WithdrawController + AdminWithdrawController
9. **Module** — WithdrawModule registrando tudo
10. **Testes unitários** — Use cases com mocks
11. **Frontend saque (usuário)** — Página completa com resumo, modal, histórico
12. **Frontend admin saques** — Página de gerenciamento com filtros, detalhes, aprovação, rejeição
13. **Upload de imagem** — Endpoint + integração frontend
