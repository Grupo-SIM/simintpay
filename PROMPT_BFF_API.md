# PROMPT: Construir API BFF (Backend For Frontend) — SimPay Platform

## Contexto Geral

Estou construindo uma plataforma de pagamentos chamada **SimPay** (similar à dompagamentos.com.br). Já possuo:

1. **api-dom** — API core NestJS que se comunica diretamente com a DOM Pagamentos (`apiv3.dompagamentos.com.br`). Ela gerencia transações, wallets, webhooks, saques, taxas, afiliados, planos PIX e máquinas POS. Roda na porta 3333.
2. **Frontend (admin-card-machine/web)** — Next.js 16 com App Router, Tailwind CSS v4, TypeScript. Roda na porta 3000. Já possui páginas de login, cadastro, painel, saques, extrato, transações, relatórios, planos, assinantes, links de pagamento, downloads e configurações.

Preciso construir uma **API BFF (Backend For Frontend)** que fica entre o frontend e a api-dom. O frontend NUNCA deve se comunicar diretamente com a api-dom.

```
[DOM Pagamentos API] ──webhook──▸ [api-dom :3333] ──webhook/eventos──▸ [BFF API :3001]
                                        ▲                                    ▲
                                        |                                    |
                                  (server-to-server)                   [Frontend :3000]
                                   chamadas internas
```

---

## Stack Obrigatória

- **NestJS** (última versão estável)
- **Prisma ORM** com **PostgreSQL** (banco separado da api-dom)
- **Redis** para cache, rate limiting e sessões
- **RabbitMQ** para processamento assíncrono de webhooks e eventos
- **TypeScript** strict mode
- **Princípios SOLID**
- **Clean Architecture** (camadas bem definidas)

---

## Arquitetura Clean Architecture — Estrutura de Pastas

```
src/
├── main.ts                              # Bootstrap (NestJS)
├── app.module.ts                        # Root module
│
├── core/                                # CAMADA DE DOMÍNIO (Enterprise Business Rules)
│   ├── entities/                        # Entidades de domínio (classes puras, sem dependência de framework)
│   │   ├── user.entity.ts
│   │   ├── session.entity.ts
│   │   ├── transaction.entity.ts
│   │   ├── wallet.entity.ts
│   │   ├── withdraw-request.entity.ts
│   │   ├── payment-link.entity.ts
│   │   ├── subscription.entity.ts
│   │   ├── plan.entity.ts
│   │   ├── customer.entity.ts
│   │   ├── balance-log.entity.ts
│   │   └── webhook-event.entity.ts
│   │
│   ├── enums/                           # Enums de domínio
│   │   ├── transaction-status.enum.ts   # PENDENTE, APROVADA, RECUSADA, ESTORNADA, CHARGEBACK, EM_MEDIACAO, EXPIRADA
│   │   ├── payment-method.enum.ts       # PIX, CREDIT_CARD
│   │   ├── withdraw-status.enum.ts      # PENDENTE, APROVADO, REJEITADO, PAGO
│   │   └── plan-type.enum.ts            # MENSAL, TRIMESTRAL, SEMESTRAL, ANUAL
│   │
│   ├── repositories/                    # Interfaces dos repositórios (contratos/ports)
│   │   ├── user.repository.interface.ts
│   │   ├── session.repository.interface.ts
│   │   ├── transaction.repository.interface.ts
│   │   ├── wallet.repository.interface.ts
│   │   ├── withdraw.repository.interface.ts
│   │   ├── payment-link.repository.interface.ts
│   │   ├── subscription.repository.interface.ts
│   │   ├── plan.repository.interface.ts
│   │   ├── customer.repository.interface.ts
│   │   ├── balance-log.repository.interface.ts
│   │   └── webhook-event.repository.interface.ts
│   │
│   ├── services/                        # Interfaces de serviços externos (ports)
│   │   ├── payment-gateway.interface.ts     # Contrato para comunicação com api-dom
│   │   ├── cache.interface.ts               # Contrato para Redis
│   │   ├── queue.interface.ts               # Contrato para RabbitMQ
│   │   ├── notification.interface.ts        # Contrato para notificações (email, push)
│   │   └── hash.interface.ts                # Contrato para hashing (bcrypt)
│   │
│   └── errors/                          # Exceções de domínio customizadas
│       ├── domain-error.ts
│       ├── insufficient-balance.error.ts
│       ├── invalid-credentials.error.ts
│       ├── duplicate-withdraw.error.ts
│       ├── invalid-status-transition.error.ts
│       └── entity-not-found.error.ts
│
├── application/                         # CAMADA DE APLICAÇÃO (Use Cases)
│   ├── use-cases/
│   │   ├── auth/
│   │   │   ├── login.use-case.ts
│   │   │   ├── register.use-case.ts
│   │   │   ├── refresh-token.use-case.ts
│   │   │   ├── logout.use-case.ts
│   │   │   └── get-me.use-case.ts
│   │   │
│   │   ├── transaction/
│   │   │   ├── list-transactions.use-case.ts
│   │   │   ├── get-transaction.use-case.ts
│   │   │   ├── create-pix-payment.use-case.ts
│   │   │   ├── create-credit-card-payment.use-case.ts
│   │   │   ├── check-payment-status.use-case.ts
│   │   │   └── export-transactions.use-case.ts
│   │   │
│   │   ├── wallet/
│   │   │   ├── get-balance.use-case.ts
│   │   │   ├── get-balance-logs.use-case.ts
│   │   │   └── get-financial-summary.use-case.ts
│   │   │
│   │   ├── withdraw/
│   │   │   ├── request-withdraw.use-case.ts
│   │   │   ├── list-withdrawals.use-case.ts
│   │   │   ├── approve-withdraw.use-case.ts      # Admin
│   │   │   └── reject-withdraw.use-case.ts        # Admin
│   │   │
│   │   ├── webhook/
│   │   │   └── process-webhook.use-case.ts
│   │   │
│   │   ├── payment-link/
│   │   │   ├── create-payment-link.use-case.ts
│   │   │   ├── list-payment-links.use-case.ts
│   │   │   ├── get-payment-link.use-case.ts
│   │   │   ├── update-payment-link.use-case.ts
│   │   │   ├── delete-payment-link.use-case.ts
│   │   │   └── checkout-payment-link.use-case.ts
│   │   │
│   │   ├── plan/
│   │   │   ├── create-plan.use-case.ts
│   │   │   ├── list-plans.use-case.ts
│   │   │   ├── delete-plan.use-case.ts
│   │   │   └── get-plan-access.use-case.ts
│   │   │
│   │   ├── subscription/
│   │   │   ├── list-subscriptions.use-case.ts
│   │   │   ├── get-subscription.use-case.ts
│   │   │   └── cancel-subscription.use-case.ts
│   │   │
│   │   ├── report/
│   │   │   ├── dashboard-summary.use-case.ts
│   │   │   ├── monthly-revenue.use-case.ts
│   │   │   ├── transactions-report.use-case.ts
│   │   │   └── export-report.use-case.ts
│   │   │
│   │   └── settings/
│   │       ├── get-profile.use-case.ts
│   │       ├── update-profile.use-case.ts
│   │       ├── get-fees.use-case.ts
│   │       └── update-email-settings.use-case.ts
│   │
│   └── dtos/                            # DTOs de entrada/saída dos use cases
│       ├── auth/
│       │   ├── login.dto.ts
│       │   ├── register.dto.ts
│       │   └── auth-response.dto.ts
│       ├── transaction/
│       │   ├── create-pix-payment.dto.ts
│       │   ├── create-credit-card-payment.dto.ts
│       │   ├── list-transactions-query.dto.ts
│       │   └── transaction-response.dto.ts
│       ├── withdraw/
│       │   ├── request-withdraw.dto.ts
│       │   ├── list-withdrawals-query.dto.ts
│       │   └── withdraw-response.dto.ts
│       ├── payment-link/
│       │   ├── create-payment-link.dto.ts
│       │   └── payment-link-response.dto.ts
│       ├── plan/
│       │   ├── create-plan.dto.ts
│       │   └── plan-response.dto.ts
│       ├── report/
│       │   └── dashboard-summary.dto.ts
│       └── common/
│           ├── paginated-query.dto.ts
│           └── paginated-response.dto.ts
│
├── infrastructure/                      # CAMADA DE INFRAESTRUTURA (Frameworks & Drivers)
│   ├── database/
│   │   ├── prisma/
│   │   │   ├── prisma.module.ts
│   │   │   ├── prisma.service.ts
│   │   │   └── schema.prisma            # Schema do banco BFF
│   │   └── repositories/               # Implementações concretas dos repositórios
│   │       ├── prisma-user.repository.ts
│   │       ├── prisma-session.repository.ts
│   │       ├── prisma-transaction.repository.ts
│   │       ├── prisma-wallet.repository.ts
│   │       ├── prisma-withdraw.repository.ts
│   │       ├── prisma-payment-link.repository.ts
│   │       ├── prisma-subscription.repository.ts
│   │       ├── prisma-plan.repository.ts
│   │       ├── prisma-customer.repository.ts
│   │       ├── prisma-balance-log.repository.ts
│   │       └── prisma-webhook-event.repository.ts
│   │
│   ├── http/                            # Client HTTP para api-dom
│   │   ├── api-dom.module.ts
│   │   ├── api-dom.client.ts            # HttpService wrapper para api-dom
│   │   └── api-dom.interceptor.ts       # Retry, timeout, error mapping
│   │
│   ├── cache/
│   │   ├── redis.module.ts
│   │   ├── redis.service.ts             # Implementação do CacheInterface
│   │   └── cache-keys.ts               # Constantes de chaves de cache
│   │
│   ├── queue/
│   │   ├── rabbitmq.module.ts
│   │   ├── rabbitmq.service.ts          # Implementação do QueueInterface
│   │   ├── consumers/
│   │   │   └── webhook.consumer.ts      # Consumer do queue de webhooks
│   │   └── queue-names.ts              # Constantes de nomes de filas
│   │
│   ├── security/
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts        # Guard JWT (access token)
│   │   │   ├── jwt-refresh.guard.ts     # Guard JWT (refresh token)
│   │   │   ├── roles.guard.ts           # Guard de roles (USER, ADMIN)
│   │   │   └── rate-limit.guard.ts      # Rate limiting via Redis
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts          # Passport JWT strategy
│   │   │   └── jwt-refresh.strategy.ts
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   ├── roles.decorator.ts
│   │   │   └── public.decorator.ts
│   │   └── bcrypt.service.ts            # Implementação do HashInterface
│   │
│   └── config/
│       ├── app.config.ts                # Configurações gerais da app
│       ├── database.config.ts
│       ├── redis.config.ts
│       ├── rabbitmq.config.ts
│       ├── jwt.config.ts
│       ├── api-dom.config.ts            # URL e credenciais da api-dom
│       └── cors.config.ts
│
├── presentation/                        # CAMADA DE APRESENTAÇÃO (Interface Adapters)
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── transaction.controller.ts
│   │   ├── wallet.controller.ts
│   │   ├── withdraw.controller.ts
│   │   ├── webhook.controller.ts
│   │   ├── payment-link.controller.ts
│   │   ├── plan.controller.ts
│   │   ├── subscription.controller.ts
│   │   ├── report.controller.ts
│   │   ├── settings.controller.ts
│   │   └── health.controller.ts
│   │
│   ├── filters/
│   │   ├── all-exceptions.filter.ts         # Captura exceções não tratadas
│   │   ├── domain-exception.filter.ts       # Mapeia DomainErrors para HTTP responses
│   │   └── http-exception.filter.ts
│   │
│   ├── interceptors/
│   │   ├── logging.interceptor.ts           # Log de requests/responses
│   │   ├── transform-response.interceptor.ts # Padroniza formato de resposta
│   │   └── timeout.interceptor.ts
│   │
│   ├── pipes/
│   │   └── validation.pipe.ts               # Custom validation pipe
│   │
│   └── middlewares/
│       ├── correlation-id.middleware.ts      # Gera ID único por request
│       ├── request-logger.middleware.ts      # Log de todas as requests
│       └── helmet.middleware.ts             # Headers de segurança
│
└── shared/                              # Utilitários compartilhados
    ├── constants/
    │   ├── error-messages.ts
    │   └── api-dom-endpoints.ts         # Mapeamento de endpoints da api-dom
    ├── utils/
    │   ├── document-validator.ts        # Validação de CPF/CNPJ
    │   ├── date.utils.ts
    │   └── money.utils.ts              # Formatação e cálculos monetários
    └── types/
        └── common.types.ts
```

---

## Princípios SOLID — Aplicação Detalhada

### S — Single Responsibility
- Cada **use case** faz exatamente UMA coisa (ex: `LoginUseCase` só autentica, não cria sessão E busca perfil)
- Cada **controller** só recebe HTTP request e delega para use cases
- Cada **repository** só lida com persistência de UMA entidade
- **Filters** separados: um para exceções de domínio, outro para HTTP, outro para exceções genéricas

### O — Open/Closed
- Use cases recebem **interfaces** (ports) dos repositórios e serviços externos, permitindo trocar implementações sem alterar use cases
- O `PaymentGatewayInterface` pode ser implementado com api-dom hoje e trocado amanhã sem mudar nenhum use case
- Adicionar novo método de pagamento = criar novo use case, não modificar existente

### L — Liskov Substitution
- Todas as implementações de repositório (`PrismaUserRepository`) podem substituir sua interface (`IUserRepository`) sem quebrar o sistema
- Diferentes implementações de cache (Redis, In-Memory para testes) são intercambiáveis

### I — Interface Segregation
- `IPaymentGateway` NÃO tem métodos de admin e de usuário juntos — segregar em `IPaymentGateway` e `IAdminPaymentGateway`
- `IUserRepository` não expõe métodos de wallet — wallet tem seu próprio `IWalletRepository`
- Guards são granulares: `JwtAuthGuard`, `RolesGuard`, `RateLimitGuard` — cada um com uma responsabilidade

### D — Dependency Inversion
- **Use cases** dependem de interfaces (core/repositories, core/services), NUNCA de Prisma, Redis, ou HTTP client diretamente
- **Módulos de infraestrutura** fornecem implementações via injeção de dependência do NestJS
- Exemplo:
  ```typescript
  // core/repositories/user.repository.interface.ts
  export const USER_REPOSITORY = Symbol('IUserRepository');
  export interface IUserRepository {
    findById(id: string): Promise<UserEntity | null>;
    findByEmail(email: string): Promise<UserEntity | null>;
    create(data: CreateUserData): Promise<UserEntity>;
    update(id: string, data: UpdateUserData): Promise<UserEntity>;
  }

  // application/use-cases/auth/login.use-case.ts
  @Injectable()
  export class LoginUseCase {
    constructor(
      @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
      @Inject(HASH_SERVICE) private readonly hashService: IHashService,
      // ...
    ) {}
  }

  // infrastructure/database/repositories/prisma-user.repository.ts
  @Injectable()
  export class PrismaUserRepository implements IUserRepository {
    constructor(private readonly prisma: PrismaService) {}
    // implementação...
  }

  // No módulo:
  { provide: USER_REPOSITORY, useClass: PrismaUserRepository }
  ```

---

## Schema Prisma do BFF (banco próprio, SEPARADO da api-dom)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// AUTH & USERS
// ============================================================

enum Role {
  USER
  ADMIN
}

model User {
  id            String    @id @default(uuid())
  name          String
  email         String    @unique
  password      String    // bcrypt hashed
  role          Role      @default(USER)
  isActive      Boolean   @default(true)

  // Referência ao user na api-dom (sincronizado no registro)
  domUserId     String?   @unique
  domToken      String?   // x-access-token da api-dom para este user

  wallet        Wallet?
  sessions      Session[]
  transactions  Transaction[]
  withdrawals   WithdrawRequest[]
  paymentLinks  PaymentLink[]
  plans         Plan[]
  subscriptions Subscription[]
  balanceLogs   BalanceLog[]
  customers     Customer[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([email])
  @@index([domUserId])
}

model Session {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshToken  String   @unique
  userAgent     String?
  ipAddress     String?
  expiresAt     DateTime
  createdAt     DateTime @default(now())

  @@index([userId])
  @@index([refreshToken])
  @@index([expiresAt])
}

// ============================================================
// WALLET & FINANCEIRO
// ============================================================

model Wallet {
  id             String   @id @default(uuid())
  balance        Decimal  @default(0) @db.Decimal(12, 2)
  lockedBalance  Decimal  @default(0) @db.Decimal(12, 2)
  version        Int      @default(0) // Optimistic locking
  userId         String   @unique
  user           User     @relation(fields: [userId], references: [id])
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model BalanceLog {
  id              String   @id @default(uuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  action          String   // WEBHOOK_PAID, WEBHOOK_REFUND, WITHDRAW_APPROVED, etc.
  transactionId   String?
  amount          Decimal  @db.Decimal(12, 2)
  balanceBefore   Decimal  @db.Decimal(12, 2)
  balanceAfter    Decimal  @db.Decimal(12, 2)
  lockedBefore    Decimal  @db.Decimal(12, 2)
  lockedAfter     Decimal  @db.Decimal(12, 2)
  description     String?
  source          String   // WEBHOOK, WITHDRAW, MANUAL, SYNC
  metadata        Json?
  createdAt       DateTime @default(now())

  @@index([userId])
  @@index([transactionId])
  @@index([createdAt])
}

// ============================================================
// TRANSAÇÕES
// ============================================================

enum TransactionStatus {
  DRAFT
  PENDING
  COMPLETED
  FAILED
  REFUNDED
  EXPIRED
  IN_MEDIATION
  CHARGEBACK
  PENDING_REFUND
}

enum PaymentMethod {
  PIX
  CREDIT_CARD
}

model Transaction {
  id                   String            @id @default(uuid())
  userId               String
  user                 User              @relation(fields: [userId], references: [id])
  amount               Decimal           @db.Decimal(12, 2)
  netAmount            Decimal?          @db.Decimal(12, 2) // Valor líquido após taxas
  status               TransactionStatus @default(DRAFT)
  previousStatus       TransactionStatus?
  paymentMethod        PaymentMethod     @default(PIX)
  description          String?
  installments         Int               @default(1)

  // Fees
  totalFee             Decimal           @default(0) @db.Decimal(12, 2)
  domFee               Decimal           @default(0) @db.Decimal(12, 2)
  platformFee          Decimal           @default(0) @db.Decimal(12, 2)

  // Referência na api-dom
  domTransactionId     String?           @unique
  domPaymentId         String?           @unique

  // PIX data (cacheado da api-dom)
  pixQrCode            String?
  pixContent           String?
  pixExpire            DateTime?

  // Card data
  cardBrand            String?
  cardBin              String?

  // Customer data
  customerName         String?
  customerEmail        String?
  customerDocument     String?
  customerPhone        String?

  // Payment link reference
  paymentLinkId        String?
  paymentLink          PaymentLink?      @relation(fields: [paymentLinkId], references: [id])

  statusHistory        TransactionStatusHistory[]

  createdAt            DateTime          @default(now())
  updatedAt            DateTime          @updatedAt

  @@index([userId])
  @@index([status])
  @@index([domPaymentId])
  @@index([createdAt])
  @@index([paymentMethod])
}

model TransactionStatusHistory {
  id             String            @id @default(uuid())
  transactionId  String
  transaction    Transaction       @relation(fields: [transactionId], references: [id])
  fromStatus     TransactionStatus
  toStatus       TransactionStatus
  metadata       Json?
  createdAt      DateTime          @default(now())

  @@index([transactionId])
}

// ============================================================
// SAQUES
// ============================================================

enum WithdrawStatus {
  PENDING
  APPROVED
  COMPLETED
  REJECTED
}

model WithdrawRequest {
  id              String         @id @default(uuid())
  userId          String
  user            User           @relation(fields: [userId], references: [id])
  amount          Decimal        @db.Decimal(12, 2) // Valor líquido
  grossAmount     Decimal        @db.Decimal(12, 2) // Valor bruto
  fee             Decimal        @default(2.00) @db.Decimal(12, 2)
  status          WithdrawStatus @default(PENDING)
  pixKey          String
  receiptImage    String?
  rejectionReason String?

  // Referência na api-dom
  domWithdrawId   String?        @unique

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([userId])
  @@index([status])
  @@index([createdAt])
}

// ============================================================
// LINKS DE PAGAMENTO
// ============================================================

model PaymentLink {
  id               String        @id @default(uuid())
  userId           String
  user             User          @relation(fields: [userId], references: [id])
  code             String        @unique @default(uuid())
  title            String
  description      String?
  amount           Decimal       @db.Decimal(12, 2)
  maxInstallments  Int           @default(1)
  isActive         Boolean       @default(true)
  transactions     Transaction[]

  // Referência na api-dom
  domPaymentLinkId String?       @unique

  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  @@index([userId])
  @@index([code])
}

// ============================================================
// PLANOS & ASSINATURAS
// ============================================================

enum PlanType {
  MONTHLY
  TRIMESTRAL
  SEMESTRAL
  ANUAL
}

model Plan {
  id            String         @id @default(uuid())
  userId        String
  user          User           @relation(fields: [userId], references: [id])
  name          String
  description   String?
  price         Decimal        @db.Decimal(12, 2)
  type          PlanType
  isActive      Boolean        @default(true)
  webhookUrl    String?
  redirectUrl   String?
  subscriptions Subscription[]

  // Referência na api-dom
  domPlanId     String?        @unique

  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  @@index([userId])
}

model Subscription {
  id                  String   @id @default(uuid())
  userId              String
  user                User     @relation(fields: [userId], references: [id])
  planId              String
  plan                Plan     @relation(fields: [planId], references: [id])
  customerId          String?
  customer            Customer? @relation(fields: [customerId], references: [id])
  status              String   @default("active") // active, cancelled, expired, paused
  expiresAt           DateTime?
  totalDaysCredited   Int      @default(0)

  // Referência na api-dom
  domSubscriptionId   String?  @unique

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@index([userId])
  @@index([planId])
  @@index([status])
}

model Customer {
  id            String         @id @default(uuid())
  userId        String
  user          User           @relation(fields: [userId], references: [id])
  name          String
  email         String
  document      String
  documentType  String         @default("CPF")
  phone         String?
  subscriptions Subscription[]

  // Referência na api-dom
  domCustomerId String?

  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  @@unique([userId, document])
  @@index([email])
}

// ============================================================
// WEBHOOKS (processamento e idempotência)
// ============================================================

model WebhookEvent {
  id          String   @id @default(uuid())
  eventId     String   @unique   // signature da api-dom
  source      String   // 'api-dom', 'dom-pagamentos'
  eventType   String   // 'transaction.paid', 'transaction.refunded', etc.
  payload     Json
  status      String   @default("PENDING") // PENDING, PROCESSED, FAILED
  retryCount  Int      @default(0)
  error       String?
  processedAt DateTime?
  createdAt   DateTime @default(now())

  @@index([eventId])
  @@index([status])
}

// ============================================================
// CONFIGURAÇÕES
// ============================================================

model UserSettings {
  id             String   @id @default(uuid())
  userId         String   @unique
  emailNotifications Boolean @default(true)
  webhookUrl     String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

---

## Endpoints da BFF API — Contrato Completo

O frontend (Next.js) se comunica APENAS com esta API na porta 3001. A base URL será `http://localhost:3001` (dev) e configurável via env.

### Formato padrão de resposta

```typescript
// Sucesso
{
  "data": T,
  "message"?: string
}

// Erro
{
  "statusCode": number,
  "message": string | string[],
  "error": string,
  "timestamp": string,
  "path": string,
  "correlationId": string
}

// Paginado (o frontend espera EXATAMENTE este formato)
{
  "data": T[],
  "page": number,
  "pageSize": number,
  "total": number
}
```

---

### 1. AUTH — `/auth`

#### `POST /auth/login`
**Body:**
```json
{
  "email": "string (required, valid email)",
  "password": "string (required, min 6)"
}
```
**Fluxo interno:**
1. Busca user no banco BFF por email
2. Compara password com bcrypt
3. Se não existe no BFF mas existe na api-dom: chama `POST api-dom:3333/auth/generate-token` com `{ email, password }` para validar credenciais, se válido cria user no BFF sincronizado
4. Gera JWT access token (expira em 15 min) e refresh token (expira em 7 dias)
5. Salva Session no banco com refresh token, IP e user-agent
6. Retorna tokens

**Response 200:**
```json
{
  "data": {
    "accessToken": "jwt...",
    "refreshToken": "uuid...",
    "expiresIn": 900,
    "user": {
      "id": "uuid",
      "name": "string",
      "email": "string",
      "role": "USER | ADMIN"
    }
  }
}
```
**O frontend deve salvar accessToken em localStorage como `access_token` e também setar cookie `access_token` com o JWT.**

**Response 401:** `{ "message": "Credenciais inválidas", "statusCode": 401 }`

#### `POST /auth/register`
**Body:**
```json
{
  "name": "string (required, min 2)",
  "email": "string (required, valid email)",
  "password": "string (required, min 6)",
  "document": "string (optional, CPF/CNPJ)"
}
```
**Fluxo interno:**
1. Valida se email já existe no BFF → 409 Conflict
2. Hash password com bcrypt (salt 12)
3. Chama `POST api-dom:3333/auth/register` com `{ name, email, password }` → obtém `domUserId`
4. Chama `POST api-dom:3333/auth/generate-token` com `{ email, password }` → obtém `domToken`
5. Cria User no BFF com `domUserId` e `domToken`
6. Cria Wallet no BFF (balance 0)
7. Gera tokens JWT como no login
8. Retorna tokens

**Response 201:** Mesmo formato do login
**Response 409:** `{ "message": "Email já cadastrado", "statusCode": 409 }`

#### `POST /auth/refresh`
**Body:**
```json
{
  "refreshToken": "string (required)"
}
```
**Fluxo interno:**
1. Busca Session por refreshToken
2. Valida que não expirou
3. Deleta session antiga
4. Cria nova session com novo refresh token
5. Gera novo access token JWT

**Response 200:**
```json
{
  "data": {
    "accessToken": "jwt...",
    "refreshToken": "novo-uuid...",
    "expiresIn": 900
  }
}
```

#### `POST /auth/logout`
**Headers:** `Authorization: Bearer <accessToken>`
**Body:**
```json
{
  "refreshToken": "string (required)"
}
```
**Fluxo:** Deleta Session do banco. Opcional: adiciona accessToken a blacklist no Redis (TTL = tempo restante do token).

**Response 204:** No content

#### `GET /auth/me`
**Headers:** `Authorization: Bearer <accessToken>`

**Fluxo interno:**
1. Extrai userId do JWT
2. Busca user no BFF com wallet
3. Opcionalmente enriquece com dados da api-dom: `GET api-dom:3333/auth/me` com header `x-access-token: <user.domToken>`

**Response 200:**
```json
{
  "data": {
    "id": "uuid",
    "name": "string",
    "email": "string",
    "role": "USER",
    "wallet": {
      "balance": 1500.00,
      "lockedBalance": 200.00,
      "availableBalance": 1300.00,
      "netBalance": 1183.00
    },
    "createdAt": "ISO date"
  }
}
```

---

### 2. TRANSAÇÕES — `/transacoes`

**NOTA:** O frontend usa nomes em **português** para os endpoints: `/transacoes`, `/saques`, etc.

#### `GET /transacoes`
**Headers:** `Authorization: Bearer <accessToken>`
**Query params:**
```
page?: number (default 1)
pageSize?: number (default 20, max 100)
status?: "PENDENTE" | "APROVADA" | "RECUSADA" | "ESTORNADA"
q?: string (busca por descrição, email, nome do cliente)
dataInicio?: string (ISO date, filtro de data início)
dataFim?: string (ISO date, filtro de data fim)
metodo?: "PIX" | "CREDIT_CARD"
```

**Fluxo interno:**
1. Busca transações do user no banco BFF com filtros
2. Mapeia status internos para nomes PT-BR para o frontend:
   - `COMPLETED` → `APROVADA`
   - `PENDING` / `DRAFT` → `PENDENTE`
   - `FAILED` / `EXPIRED` → `RECUSADA`
   - `REFUNDED` / `CHARGEBACK` → `ESTORNADA`
3. Cache no Redis: key `transactions:${userId}:${hash(query)}`, TTL 30s

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "valor": 150.00,
      "valorLiquido": 136.50,
      "status": "APROVADA",
      "metodo": "PIX",
      "descricao": "Pagamento produto X",
      "parcelas": 1,
      "cliente": {
        "nome": "João Silva",
        "email": "joao@email.com",
        "documento": "123.456.789-00"
      },
      "taxas": {
        "total": 13.50,
        "dom": 2.47,
        "plataforma": 11.03
      },
      "criadoEm": "2026-02-14T10:30:00Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 150
}
```

#### `GET /transacoes/:id`
**Headers:** `Authorization: Bearer <accessToken>`

**Response 200:** Mesmo objeto da lista, com campos adicionais:
```json
{
  "data": {
    "...campos da lista",
    "pixQrCode": "base64...",
    "pixContent": "copia-e-cola...",
    "pixExpire": "2026-02-15T10:30:00Z",
    "cardBrand": "visa",
    "historicoStatus": [
      { "de": "PENDENTE", "para": "APROVADA", "em": "ISO date" }
    ]
  }
}
```

#### `POST /transacoes/pix`
**Headers:** `Authorization: Bearer <accessToken>`
**Body:**
```json
{
  "descricao": "string (required)",
  "valor": "number (required, min 5.00)",
  "cliente": {
    "nome": "string (required, min 2)",
    "email": "string (required, valid email)",
    "documento": "string (required, CPF ou CNPJ)",
    "tipoDocumento": "CPF | CNPJ",
    "telefone": "string (required)"
  }
}
```

**Fluxo interno:**
1. Valida todos os campos (ValidationPipe + validações customizadas de CPF/CNPJ)
2. Chama api-dom: `POST api-dom:3333/payments` com header `x-access-token: <user.domToken>` e body:
   ```json
   {
     "description": "<descricao>",
     "name": "<cliente.nome>",
     "email": "<cliente.email>",
     "document_type": "<tipoDocumento>",
     "document": "<documento>",
     "mobile_phone": "<telefone>",
     "price": <valor>
   }
   ```
3. api-dom cria transação na DOM Pagamentos e retorna `{ paymentId, transactionId, status, ...pixData }`
4. Cria Transaction no banco BFF com referência `domTransactionId` e `domPaymentId`
5. Retorna dados do PIX para o frontend

**Response 201:**
```json
{
  "data": {
    "id": "uuid (BFF)",
    "domPaymentId": "string",
    "status": "PENDENTE",
    "pixQrCode": "base64...",
    "pixContent": "copia-e-cola PIX...",
    "pixExpire": "2026-02-15T10:30:00Z",
    "valor": 150.00
  }
}
```

#### `POST /transacoes/cartao`
**Headers:** `Authorization: Bearer <accessToken>`
**Body:**
```json
{
  "descricao": "string",
  "valor": "number (required, min 5.00)",
  "parcelas": "number (1-12)",
  "cartao": {
    "holderName": "string (required)",
    "token": "string (required, tokenizado no front)",
    "bin": "string (required)",
    "brand": "string (required)"
  },
  "cliente": {
    "nome": "string (required)",
    "email": "string (required)",
    "documento": "string (required)",
    "tipoDocumento": "CPF | CNPJ",
    "telefone": "string (required)"
  }
}
```

**Fluxo interno:**
1. Valida campos
2. Chama api-dom: `POST api-dom:3333/payments/credit-card` com `x-access-token` e body mapeado:
   ```json
   {
     "price": <valor>,
     "holder_name": "<cartao.holderName>",
     "token": "<cartao.token>",
     "bin": "<cartao.bin>",
     "brand": "<cartao.brand>",
     "installments": <parcelas>,
     "description": "<descricao>",
     "email": "<cliente.email>",
     "document": "<cliente.documento>",
     "document_type": "<cliente.tipoDocumento>",
     "mobile_phone": "<cliente.telefone>",
     "name": "<cliente.nome>"
   }
   ```
3. Cria Transaction no BFF com `domTransactionId`, `domPaymentId`
4. Retorna resultado

**Response 201:**
```json
{
  "data": {
    "id": "uuid (BFF)",
    "domPaymentId": "string",
    "status": "PENDENTE",
    "valor": 150.00,
    "parcelas": 3,
    "taxas": {
      "total": 20.50,
      "vendedor": 15.00,
      "cliente": 5.50,
      "parcelaValor": 51.83
    }
  }
}
```

#### `GET /transacoes/:id/status`
**Headers:** `Authorization: Bearer <accessToken>` (ou público, dependendo do caso)

**Fluxo:** Busca transação no BFF. Opcionalmente, se status for PENDING há mais de 5 min, consulta api-dom: `GET api-dom:3333/payments/<domPaymentId>/status`

**Response 200:**
```json
{
  "data": {
    "id": "uuid",
    "status": "PENDENTE",
    "domPaymentId": "string"
  }
}
```

#### `GET /transacoes/exportar`
**Headers:** `Authorization: Bearer <accessToken>`
**Query:** `dataInicio`, `dataFim`, `formato=csv|xlsx`

**Fluxo:** Busca transações, gera arquivo, retorna download.

---

### 3. SAQUES — `/saques`

#### `GET /saques`
**Headers:** `Authorization: Bearer <accessToken>`
**Query:**
```
page?: number (default 1)
pageSize?: number (default 20)
status?: "PENDENTE" | "APROVADO" | "REJEITADO" | "PAGO"
```

**Fluxo interno:**
1. Busca WithdrawRequests do user no BFF
2. Mapeia status:
   - `PENDING` → `PENDENTE`
   - `APPROVED` → `APROVADO`
   - `COMPLETED` → `PAGO`
   - `REJECTED` → `REJEITADO`

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
      "criadoEm": "2026-02-14T10:30:00Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 5
}
```

#### `POST /saques`
**Headers:** `Authorization: Bearer <accessToken>`
**Body:**
```json
{
  "valor": "number (required, min 100)",
  "chavePix": "string (required, formato CPF 000.000.000-00 ou CNPJ 00.000.000/0000-00)"
}
```

**Fluxo interno:**
1. Valida `valor >= 100`
2. Valida formato da chave PIX (regex)
3. Verifica se não existe saque PENDING ou APPROVED para este user no BFF
4. Chama api-dom: `POST api-dom:3333/payments/withdraw` com `x-access-token` e body:
   ```json
   {
     "amount": <valor>,
     "pixKey": "<chavePix>"
   }
   ```
5. api-dom valida saldo, trava lockedBalance, cria WithdrawRequest, retorna `{ requestId, fee, netAmount, totalAmount }`
6. Cria WithdrawRequest no BFF sincronizado
7. Invalida cache de wallet no Redis

**Response 201:**
```json
{
  "data": {
    "id": "uuid",
    "valor": 98.00,
    "valorBruto": 100.00,
    "taxa": 2.00,
    "status": "PENDENTE",
    "chavePix": "123.456.789-00"
  },
  "message": "Saque solicitado com sucesso"
}
```

**Response 400:** `{ "message": "Valor mínimo para saque é R$ 100,00" }`
**Response 409:** `{ "message": "Já existe um saque pendente" }`
**Response 422:** `{ "message": "Saldo insuficiente" }`

#### `POST /saques/:id/aprovar` (ADMIN)
**Headers:** `Authorization: Bearer <accessToken>` (role: ADMIN)
**Body:**
```json
{
  "comprovante": "string (URL da imagem do comprovante)"
}
```

**Fluxo:** Chama api-dom `POST api-dom:3333/payments/<domWithdrawId>/approve` com `x-access-token: MASTER_KEY` e body `{ receiptImage }`. Atualiza BFF.

#### `POST /saques/:id/rejeitar` (ADMIN)
**Headers:** `Authorization: Bearer <accessToken>` (role: ADMIN)
**Body:**
```json
{
  "motivo": "string (required)"
}
```

**Fluxo:** Chama api-dom `POST api-dom:3333/payments/<domWithdrawId>/reject` com body `{ rejectionReason }`. Atualiza BFF.

---

### 4. WALLET — `/wallet`

#### `GET /wallet/saldo`
**Headers:** `Authorization: Bearer <accessToken>`

**Fluxo:**
1. Busca Wallet do user no BFF
2. Cache Redis: `wallet:${userId}`, TTL 60s
3. Calcula `availableBalance = balance - lockedBalance`
4. Calcula `netBalance = availableBalance * 0.91` (91% — consistente com api-dom)

**Response 200:**
```json
{
  "data": {
    "saldo": 1500.00,
    "saldoBloqueado": 200.00,
    "saldoDisponivel": 1300.00,
    "saldoLiquido": 1183.00
  }
}
```

#### `GET /wallet/extrato`
**Headers:** `Authorization: Bearer <accessToken>`
**Query:** `page`, `pageSize`, `dataInicio`, `dataFim`, `tipo` (ENTRADA, SAIDA, TODOS)

**Fluxo:** Busca BalanceLogs do user, mapeia para formato amigável.

**Response 200:**
```json
{
  "data": [
    {
      "id": "uuid",
      "tipo": "ENTRADA",
      "descricao": "Pagamento PIX recebido",
      "valor": 150.00,
      "saldoAntes": 1350.00,
      "saldoDepois": 1500.00,
      "criadoEm": "ISO date"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 50
}
```

#### `GET /wallet/resumo`
**Headers:** `Authorization: Bearer <accessToken>`

**Fluxo:** Chama api-dom `GET api-dom:3333/payments/summary` com `x-access-token`. Cache Redis TTL 5 min.

**Response 200:**
```json
{
  "data": {
    "saldoDisponivel": 1300.00,
    "recebiveis": 500.00,
    "assinaturasAtivas": 12,
    "chargebacks": 2,
    "totalRecebidoMes": 5000.00,
    "totalSaquesMes": 2000.00,
    "transacoesHoje": 15,
    "ticketMedio": 150.00
  }
}
```

---

### 5. LINKS DE PAGAMENTO — `/links-pagamento`

#### `GET /links-pagamento`
**Headers:** `Authorization: Bearer <accessToken>`
**Query:** `page`, `pageSize`

#### `POST /links-pagamento`
**Headers:** `Authorization: Bearer <accessToken>`
**Body:**
```json
{
  "titulo": "string (required)",
  "descricao": "string",
  "valor": "number (required)",
  "parcelasMax": "number (1-12, default 1)"
}
```

**Fluxo:** Chama api-dom `POST api-dom:3333/payment-links` com `x-access-token` e body mapeado. Salva no BFF.

#### `GET /links-pagamento/:id`
#### `PUT /links-pagamento/:id`
#### `DELETE /links-pagamento/:id`

---

### 6. PLANOS — `/planos`

#### `GET /planos`
**Headers:** `Authorization: Bearer <accessToken>`

**Fluxo:** Busca Plans do user no BFF. Opcionalmente sincroniza com api-dom `GET api-dom:3333/payments/pix-plan`.

#### `POST /planos`
**Body:**
```json
{
  "nome": "string (required)",
  "descricao": "string",
  "preco": "number (required)",
  "tipo": "MENSAL | TRIMESTRAL | SEMESTRAL | ANUAL",
  "webhookUrl": "string (url, optional)",
  "redirectUrl": "string (url, optional)"
}
```

**Fluxo:** Chama api-dom `POST api-dom:3333/payments/pix-plan` com body mapeado:
```json
{
  "price": <preco>,
  "description": "<nome> - <descricao>",
  "frequency_type": "MONTH|QUARTER|SEMESTER|YEAR",
  "webhookUrl": "<webhookUrl>",
  "redirectUrl": "<redirectUrl>"
}
```

#### `DELETE /planos/:id`

---

### 7. ASSINANTES — `/assinantes`

#### `GET /assinantes`
**Headers:** `Authorization: Bearer <accessToken>`
**Query:** `page`, `pageSize`, `status`, `planoId`

**Fluxo:** Busca Subscriptions do user. Opcionalmente enriquece com api-dom `GET api-dom:3333/payments/plan-access`.

---

### 8. RELATÓRIOS — `/relatorios`

#### `GET /relatorios/dashboard`
**Headers:** `Authorization: Bearer <accessToken>`

**Fluxo:** Agrega dados de transações, wallet e saques. Cache Redis TTL 5 min.

**Response 200:**
```json
{
  "data": {
    "receita": {
      "hoje": 500.00,
      "semana": 3500.00,
      "mes": 15000.00,
      "mesAnterior": 12000.00,
      "variacao": 25.0
    },
    "transacoes": {
      "total": 150,
      "aprovadas": 130,
      "pendentes": 10,
      "recusadas": 8,
      "estornadas": 2
    },
    "saques": {
      "pendentes": 3,
      "valorPendente": 500.00,
      "totalPago": 8000.00
    },
    "grafico": [
      { "data": "2026-02-01", "valor": 500.00, "quantidade": 10 },
      { "data": "2026-02-02", "valor": 750.00, "quantidade": 15 }
    ]
  }
}
```

#### `GET /relatorios/receita-mensal`
#### `GET /relatorios/transacoes`
#### `GET /relatorios/exportar` — `?formato=csv|xlsx|pdf`

---

### 9. CONFIGURAÇÕES — `/configuracoes`

#### `GET /configuracoes/perfil`
#### `PUT /configuracoes/perfil`
**Body:** `{ "nome", "email" }`

#### `GET /configuracoes/taxas`
**Fluxo:** Chama api-dom para obter taxas do user.

**Response 200:**
```json
{
  "data": {
    "pix": {
      "percentual": 2.5,
      "fixo": 0,
      "domFee": "0.98% + R$ 1,00"
    },
    "cartaoCredito": {
      "percentual": 2.5,
      "fixo": 0,
      "tabelaParcelas": [
        { "parcelas": 1, "taxaDom": "3.99%", "total": "3.99% + R$ 1,00" },
        { "parcelas": 2, "taxaDom": "8.30%", "total": "8.30% + R$ 1,00" },
        { "parcelas": 3, "taxaDom": "9.68%", "total": "9.68% + R$ 1,00" },
        { "parcelas": 4, "taxaDom": "11.04%", "total": "11.04% + R$ 1,00" },
        { "parcelas": 5, "taxaDom": "12.37%", "total": "12.37% + R$ 1,00" },
        { "parcelas": 6, "taxaDom": "13.67%", "total": "13.67% + R$ 1,00" },
        { "parcelas": 7, "taxaDom": "14.95%", "total": "14.95% + R$ 1,00" },
        { "parcelas": 8, "taxaDom": "16.21%", "total": "16.21% + R$ 1,00" },
        { "parcelas": 9, "taxaDom": "17.44%", "total": "17.44% + R$ 1,00" },
        { "parcelas": 10, "taxaDom": "18.64%", "total": "18.64% + R$ 1,00" },
        { "parcelas": 11, "taxaDom": "19.83%", "total": "19.83% + R$ 1,00" },
        { "parcelas": 12, "taxaDom": "20.99%", "total": "20.99% + R$ 1,00" }
      ]
    },
    "saque": {
      "taxa": 2.00,
      "minimo": 100.00,
      "percentualLiquido": 91
    }
  }
}
```

#### `GET /configuracoes/email`
#### `PUT /configuracoes/email`

---

### 10. WEBHOOK (recebe eventos da api-dom) — `/webhook`

#### `POST /webhook/api-dom`

**IMPORTANTE:** Este endpoint recebe eventos da api-dom (que por sua vez processou o webhook original da DOM Pagamentos). Você deve configurar na api-dom um forwarding para `POST <BFF_URL>/webhook/api-dom`.

**Headers de segurança:**
- `x-webhook-secret: <WEBHOOK_SECRET>` — segredo compartilhado entre api-dom e BFF
- `x-webhook-signature: <HMAC-SHA256>` — assinatura HMAC do body com o secret

**Body (enviado pela api-dom):**
```json
{
  "event": "transaction.paid | transaction.refunded | transaction.chargeback | transaction.failed | transaction.expired | transaction.mediation | withdraw.approved | withdraw.rejected",
  "signature": "string (unique event ID for idempotency)",
  "data": {
    "paymentId": "string (DOM payment ID)",
    "transactionId": "string (api-dom transaction ID)",
    "userId": "string (api-dom user ID)",
    "status": "paid | refunded | chargeback | failed | expired | in_mediation",
    "amount": 150.00,
    "amountWithoutAllFee": 136.50,
    "fee": 13.50,
    "domFee": 2.47,
    "paymentMethod": "pix | credit_card",
    "description": "string",
    "customer": {
      "name": "string",
      "email": "string",
      "document": "string",
      "phone": "string"
    },
    "serialNumber": "string | null",
    "installments": 1,
    "timestamp": "ISO date"
  }
}
```

**Fluxo interno:**
1. Valida `x-webhook-secret` e `x-webhook-signature` (HMAC-SHA256)
2. Responde `200 OK` imediatamente (acknowledge)
3. Publica evento no RabbitMQ queue `bff-webhook-events`
4. Consumer processa assincronamente:
   a. Verifica idempotência via `WebhookEvent.eventId` (signature)
   b. Encontra Transaction no BFF por `domPaymentId`
   c. Valida transição de status
   d. Atualiza Transaction.status no BFF
   e. Atualiza Wallet no BFF (espelhando a lógica da api-dom):
      - `paid` → `balance += amountWithoutAllFee`
      - `refunded/chargeback` → `balance -= amountWithoutAllFee`
      - `in_mediation` → `balance -= amountWithoutAllFee`, `lockedBalance += amountWithoutAllFee`
   f. Incrementa `wallet.version` (optimistic locking)
   g. Cria BalanceLog
   h. Cria TransactionStatusHistory
   i. Invalida caches Redis relacionados
   j. Marca WebhookEvent como PROCESSED

**Response 200:** `{ "received": true }`
**Response 401:** Se secret inválido

---

### 11. HEALTH — `/health`

#### `GET /health`
**Público, sem auth.**

**Response 200:**
```json
{
  "status": "ok",
  "timestamp": "ISO date",
  "uptime": 12345,
  "services": {
    "database": "ok",
    "redis": "ok",
    "rabbitmq": "ok",
    "apiDom": "ok"
  }
}
```

---

## Segurança — Implementações Obrigatórias

### 1. Autenticação JWT (Access + Refresh Token)
```
Access Token:
  - Algoritmo: RS256 (par de chaves RSA) ou HS256 com secret forte (min 64 chars)
  - Expira em: 15 minutos
  - Payload: { sub: userId, email, role, iat, exp }
  - Enviado via header: Authorization: Bearer <token>

Refresh Token:
  - UUID v4 armazenado no banco (model Session)
  - Expira em: 7 dias
  - Rotação: a cada uso, o refresh token antigo é invalidado e um novo é gerado
  - Limite de sessões: máximo 5 sessões ativas por user (FIFO — remove a mais antiga)
```

### 2. Blacklist de Tokens (Redis)
```
Ao fazer logout, o accessToken é adicionado a uma blacklist no Redis:
  Key: blacklist:<tokenHash>
  TTL: tempo restante até expirar o token

O JwtAuthGuard verifica a blacklist ANTES de aceitar o token.
```

### 3. Rate Limiting (Redis)
```
Usar @nestjs/throttler com Redis storage:

Rotas públicas (login, register, webhook):
  - 10 requests por minuto por IP

Rotas autenticadas:
  - 60 requests por minuto por userId

Rotas sensíveis (withdraw, payments):
  - 5 requests por minuto por userId

Response quando excede: 429 Too Many Requests
  { "message": "Muitas requisições. Tente novamente em X segundos.", "retryAfter": 30 }
```

### 4. CORS Restrito
```typescript
app.enableCors({
  origin: [
    process.env.FRONTEND_URL,  // https://simpay.jbmidia.com
    'http://localhost:3000',    // dev
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
});
```

### 5. Helmet (Headers de Segurança)
```typescript
import helmet from 'helmet';
app.use(helmet());
// X-Content-Type-Options: nosniff
// X-Frame-Options: DENY
// X-XSS-Protection: 1; mode=block
// Strict-Transport-Security: max-age=31536000; includeSubDomains
// Content-Security-Policy: default-src 'self'
```

### 6. Validação de Input
```
- Usar class-validator + class-transformer em TODOS os DTOs
- Sanitizar inputs com class-sanitizer (trim, stripLow, escape)
- Validar CPF/CNPJ com algoritmo de dígitos verificadores
- Validar formato de chave PIX
- Limitar tamanho de strings (name max 100, description max 500, etc.)
- Não aceitar campos extras (whitelist: true no ValidationPipe)
```

### 7. Proteção contra Ataques Comuns
```
- SQL Injection: Prisma ORM com prepared statements (já protegido)
- XSS: Helmet headers + sanitização de inputs
- CSRF: Token-based auth (JWT) não precisa de CSRF token, mas se usar cookies: implementar CSRF tokens
- Request Size: Limitar body a 1MB (padrão)
- Slowloris/DoS: Timeout de 30s em todas as requests
- Brute Force: Rate limiting + progressivo lockout (5 tentativas falhas = lock 5 min)
```

### 8. Webhook Security
```
Validação do webhook da api-dom:
1. Verificar header x-webhook-secret (shared secret)
2. Verificar header x-webhook-signature (HMAC-SHA256 do body com secret)
3. Idempotência via eventId/signature no banco
4. Processar assincronamente (não bloquear response)
5. Retry com backoff exponencial (3 tentativas max)
6. Dead letter queue para webhooks que falharam 3x
```

### 9. Logging e Auditoria
```
- Correlation ID em TODAS as requests (header x-correlation-id ou gerado)
- Log estruturado (JSON) com: timestamp, correlationId, userId, action, ip, userAgent
- Logar: login/logout, criação de pagamento, solicitação de saque, aprovação/rejeição de saque
- NÃO logar: passwords, tokens completos, dados de cartão
- Mascarar dados sensíveis no log: email → j***@email.com, CPF → ***.456.***-00
```

### 10. Comunicação Segura com api-dom
```
A BFF se comunica com a api-dom via HTTP interno (server-to-server).

Headers obrigatórios em TODAS as chamadas para api-dom:
  x-access-token: <user.domToken>  (para endpoints de user)
  x-access-token: MASTER_KEY_DOM_API  (para endpoints admin)

NUNCA expor o MASTER_KEY_DOM_API ou qualquer domToken para o frontend.
NUNCA retornar o domToken nas responses da BFF.

Timeout: 10s para chamadas normais, 30s para exports/relatórios
Retry: 3x com backoff exponencial para erros 5xx
Circuit Breaker: abrir circuito após 5 falhas consecutivas (usar @nestjs/terminus ou opossum)
```

---

## Variáveis de Ambiente (.env)

```env
# App
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# Database (PostgreSQL separado da api-dom)
DATABASE_URL=postgresql://user:password@localhost:5433/simpay_bff

# JWT
JWT_SECRET=<string-aleatoria-64-chars-minimo>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# RabbitMQ
RABBITMQ_URL=amqp://admin:password@localhost:5672

# Api-Dom
API_DOM_BASE_URL=http://localhost:3333
API_DOM_MASTER_KEY=MASTER_KEY_DOM_API

# Webhook Security
WEBHOOK_SECRET=<string-aleatoria-64-chars>

# Rate Limiting
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=60
```

---

## Mapeamento Completo: Endpoints da api-dom que a BFF Consome

| Funcionalidade BFF | Método | Endpoint api-dom | Header Auth | Quando |
|---|---|---|---|---|
| Login (validar creds) | POST | `/auth/generate-token` | Nenhum | Login de user que ainda não está no BFF |
| Register | POST | `/auth/register` | Nenhum | Cadastro |
| Register (token) | POST | `/auth/generate-token` | Nenhum | Após cadastro, obter domToken |
| Get profile | GET | `/auth/me` | `x-access-token: <domToken>` | Enriquecer dados de /auth/me |
| Create PIX | POST | `/payments` | `x-access-token: <domToken>` | Criar pagamento PIX |
| Create Credit Card | POST | `/payments/credit-card` | `x-access-token: <domToken>` | Criar pagamento cartão |
| Check status | GET | `/payments/:paymentId/status` | Nenhum (público) | Verificar status pagamento |
| List transactions | GET | `/payments/all` | `x-access-token: <domToken>` | Listar transações |
| Financial summary | GET | `/payments/summary` | `x-access-token: <domToken>` | Dashboard |
| Monthly revenue | GET | `/payments/monthly-revenue` | `x-access-token: <domToken>` | Relatório mensal |
| Balance logs | GET | `/payments/balance-logs/:userId` | `x-access-token: <domToken>` | Extrato |
| Request withdraw | POST | `/payments/withdraw` | `x-access-token: <domToken>` | Solicitar saque |
| List withdrawals | GET | `/payments/withdrawals` | `x-access-token: <domToken>` | Listar saques |
| Approve withdraw | POST | `/payments/:id/approve` | `x-access-token: MASTER_KEY` | Admin aprova saque |
| Reject withdraw | POST | `/payments/:id/reject` | `x-access-token: MASTER_KEY` | Admin rejeita saque |
| Get taxes | GET | `/payments/taxes` | `x-access-token: MASTER_KEY` | Config de taxas |
| Create plan | POST | `/payments/pix-plan` | `x-access-token: <domToken>` | Criar plano |
| List plans | GET | `/payments/pix-plan` | `x-access-token: <domToken>` | Listar planos |
| Delete plan | DELETE | `/payments/pix-plan/:id` | `x-access-token: <domToken>` | Deletar plano |
| Plan access | GET | `/payments/plan-access` | `x-access-token: <domToken>` | Ver assinantes |
| Create payment link | POST | `/payment-links` | `x-access-token: <domToken>` | Criar link |
| List payment links | GET | `/payment-links` | `x-access-token: <domToken>` | Listar links |
| Get payment link | GET | `/payment-links/:id` | `x-access-token: <domToken>` | Detalhes link |
| Update payment link | PUT | `/payment-links/:id` | `x-access-token: <domToken>` | Editar link |
| Delete payment link | DELETE | `/payment-links/:id` | `x-access-token: <domToken>` | Deletar link |
| Subscriptions | GET | `/subscription` | `x-access-token: <domToken>` | Listar assinaturas |
| Cancel subscription | PUT | `/subscription/:id/cancel` | `x-access-token: <domToken>` | Cancelar assinatura |

---

## Docker Compose (ambiente completo)

```yaml
version: "3.8"

services:
  bff-api:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
      - DATABASE_URL=postgresql://simpay:simpay_pass@postgres-bff:5432/simpay_bff
      - REDIS_HOST=redis-bff
      - REDIS_PORT=6379
      - RABBITMQ_URL=amqp://admin:rabbitmq_pass@rabbitmq-bff:5672
      - API_DOM_BASE_URL=http://api-dom:3333
      - API_DOM_MASTER_KEY=MASTER_KEY_DOM_API
      - FRONTEND_URL=https://simpay.jbmidia.com
      - JWT_SECRET=<gerar-secret-forte>
      - WEBHOOK_SECRET=<gerar-webhook-secret>
    depends_on:
      - postgres-bff
      - redis-bff
      - rabbitmq-bff

  postgres-bff:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: simpay
      POSTGRES_PASSWORD: simpay_pass
      POSTGRES_DB: simpay_bff
    volumes:
      - pgdata-bff:/var/lib/postgresql/data
    ports:
      - "5433:5432"

  redis-bff:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "6380:6379"

  rabbitmq-bff:
    image: rabbitmq:3-management-alpine
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: rabbitmq_pass
    ports:
      - "5673:5672"
      - "15673:15672"

volumes:
  pgdata-bff:
```

---

## Configuração Necessária na api-dom

Para que a BFF receba webhooks da api-dom, é necessário adicionar um **forwarding** no `WebhookService` da api-dom. No arquivo `src/webhook/webhook.service.ts`, adicionar no método `process()` (após processar o webhook):

```typescript
// Forward para BFF
try {
  await fetch(`${process.env.BFF_API_URL}/webhook/api-dom`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-secret': process.env.BFF_WEBHOOK_SECRET,
      'x-webhook-signature': createHmac('sha256', process.env.BFF_WEBHOOK_SECRET)
        .update(JSON.stringify(webhookPayload))
        .digest('hex'),
    },
    body: JSON.stringify({
      event: `transaction.${newStatus.toLowerCase()}`,
      signature: event.event?.signature || event.signature,
      data: {
        paymentId: event.data.id,
        transactionId: transaction.id,
        userId: transaction.userId,
        status: event.data.status,
        amount: transaction.amount,
        amountWithoutAllFee: transaction.amountWithoutAllFee,
        fee: transaction.fee,
        domFee: transaction.dom_fee,
        paymentMethod: transaction.payment_method,
        description: transaction.description,
        customer: event.data.customer,
        serialNumber: event.data.serial_number,
        installments: transaction.installments,
        timestamp: new Date().toISOString(),
      },
    }),
  });
} catch (error) {
  console.error('Failed to forward webhook to BFF:', error.message);
}
```

E adicionar no `.env` da api-dom:
```env
BFF_API_URL=http://bff-api:3001
BFF_WEBHOOK_SECRET=<mesmo-secret-do-bff>
```

---

## Resumo das Regras de Negócio Críticas

1. **Saldo líquido = (balance - lockedBalance) × 0.91** — Sempre 91% do disponível
2. **Taxa de saque = R$ 2,00 fixa** — Deduzida do valor solicitado
3. **Saque mínimo = R$ 100,00**
4. **Não permitir mais de 1 saque PENDING/APPROVED por vez**
5. **PIX DOM fee = valor × 0.0098 + R$ 1,00**
6. **Credit Card DOM fee = valor × rate[parcelas] + R$ 1,00** (tabela de 12 parcelas)
7. **Formato chave PIX saque: CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00)**
8. **Valor mínimo pagamento PIX/Cartão: R$ 5,00**
9. **Webhook idempotência: nunca processar mesmo eventId/signature duas vezes**
10. **Optimistic locking na wallet: usar campo version para evitar race conditions**
11. **Transições de status válidas:**
    - DRAFT → PENDING
    - PENDING → COMPLETED, FAILED, EXPIRED
    - COMPLETED → REFUNDED, CHARGEBACK, IN_MEDIATION
    - IN_MEDIATION → COMPLETED, REFUNDED
    - Qualquer outra transição é INVÁLIDA e deve ser rejeitada

---

## Ordem de Implementação Sugerida

1. **Setup do projeto** — NestJS, Prisma, PostgreSQL, Redis, RabbitMQ, estrutura de pastas
2. **Auth module** — Register, Login, Refresh, Logout, JWT guards, bcrypt
3. **Api-Dom client** — HttpService wrapper com retry, timeout, circuit breaker
4. **Wallet module** — Saldo, extrato, balance logs
5. **Transaction module** — Listar, criar PIX, criar cartão, verificar status
6. **Webhook module** — Receber, validar, processar assincronamente via RabbitMQ
7. **Withdraw module** — Solicitar, listar, aprovar, rejeitar
8. **Payment Link module** — CRUD
9. **Plan module** — CRUD
10. **Subscription module** — Listar, cancelar
11. **Report module** — Dashboard, receita mensal, exportar
12. **Settings module** — Perfil, taxas, email
13. **Security hardening** — Rate limiting, helmet, CORS, logging, auditoria
14. **Testes** — Unit tests nos use cases, e2e nos controllers
