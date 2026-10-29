# BalanceLog como razão única do saldo

Hoje o saldo sacável tem três fórmulas. O `/me` recalcula por `Transaction × liquidez − serviço` para contas genéricas, e por `wallet.balance` para Renovada/Bosque e carteiras compartilhadas. O resumo de saque e a validação do saque (`request-withdraw`) usam `wallet.balance − wallet.lockedBalance`, como diz `docs/business-rules.md` ("Disponibilidade de saque"). Foi essa divergência que zerou o saldo de `saut.pdc` (carteira `e3b67d1f…`, R$ 1.035,95) no frontend.

Correção pontual já aplicada: `get-me.use-case.ts` passou a usar a carteira para quem não tem plataforma própria. Este plano generaliza.

## Diagnóstico (levantado em 2026-10-29)

- **Por que Renovada e Bosque eram diferentes:** não há regra de negócio documentada. É herança. Os dois vieram de sistemas legados importados por `sync-full-renovada` e `sync-full-bosque`, que gravam o líquido direto em `wallet.balance` (comentário no código: "netAmount já descontado das taxas"). As demais plataformas ficaram no cálculo antigo por `Transaction`, que o resumo de saque já abandonou por divergir da carteira. `useRenovadaWalletLedger` e `RENOVADA_TAXA_SERVICO_DATE` existem desde o commit `a9e9078`, sem justificativa registrada.
- **Dono de plataforma com ganhos de coprodução/afiliado:** o ramo genérico ignora esses ganhos, porque o recebedor não ganha `Transaction`. O mesmo bug de `saut.pdc` atinge qualquer dono de uma plataforma (fora Renovada/Bosque) que também receba coprodução ou afiliado.
- **Escritores da carteira:** cerca de 49 arquivos de produção tocam `Wallet`. Cerca de 23 referenciam `BalanceLog`. Quais escrevem saldo sem gravar log ainda não foi auditado. Suspeitos: `platform-sync.service`, `platform-sync-persistence.service`, `platform-ledger`, `legacy-platform-payment.core`, `sync-full-*`, `pix-plan.service`.
- **Log incompleto:** em `saut.pdc` o `BalanceLog` soma R$ 879,41 e a carteira tem R$ 1.035,95. Faltam R$ 156,54, provavelmente de afiliado.

## Progresso (2026-10-29)

- [x] Regra de leitura unificada: `get-me.use-case.ts` e `computeUserNetBalance` usam `max(0, balance − lockedBalance)` para qualquer conta. Renovada, Bosque, genéricas, compartilhadas e sem plataforma seguem a mesma regra. Ramos por `Transaction` e `useRenovadaWalletLedger` removidos desses dois pontos.
- [x] Conciliação em leitura (14 carteiras): Bosque e Renovada batem com o último log que move saldo. Os logs `ADMIN_WITHDRAW_*_INC` são lançamentos contábeis de taxa (`balanceBefore = balanceAfter = 0`) e não mexem na carteira. Eles precisam sair da conciliação ou ter ação própria.
- [x] `saut.pdc`: ajuste de R$ 156,54 gravado no `BalanceLog` (`ADJUSTMENT` / `RECONCILIATION`), a pedido do dono do sistema, confirmando o ajuste manual da última coprodução. Log e carteira agora fecham em R$ 1.035,95.
- [ ] `adminljl@simpay.com.br`: carteira R$ 4.327,88 contra R$ 3.291,93 no último log (diferença R$ 1.035,95). A carteira foi atualizada às 21:02:31.062, antes do log das 21:02:31.066, que registra `balanceBefore` defasado. Sem ajuste até a causa ser confirmada.
- [x] Quebras de encadeamento: das 38 aparentes, 31 eram lançamentos de taxa (`MASTER_ADMIN_CONTROL`); as 7 reais foram fechadas na etapa 6. Segue em aberto a carteira `dono@zerograusorvetesac.com` com R$ −13,31, sem análise.
- [x] `get-withdraw-summary.use-case.ts` mantém a separação Renovada/Bosque só para taxas e configuração de saque; o saldo já vem da carteira. Revisado na etapa 9.
- [x] Etapa 1 (auditoria): escritores de saldo sem `BalanceLog` eram `platform-sync.service`, `platform-sync-persistence.service`, `platform-ledger` e `sync-full-renovada`. Todos migrados. Os demais já gravavam log com o padrão `wallet.update` seguido de `balanceLog.create`.
- [x] Etapa 2: `modules/wallet-ledger/wallet-ledger.ts` com `applyWalletEntry` (carteira e log na mesma transação, `before` derivado do retorno do update) e `setWalletBalance` (absoluto, registra a diferença).
- [x] Etapa 3: migrados para `applyWalletEntry`/`setWalletBalance` todos os escritores que movem saldo por incremento ou sem log: sync de plataforma, `platform-ledger`, `sync-full-renovada`, `coproduction-settlement`, renovação e pagamento de assinatura (`subscription-webhook`, antes sem transação e com `balanceBefore` lido antes da escrita) e, no `process-dom-webhook`, o crédito de ebook pendente (não gravava log) e o crédito Areaflix por PIX (fora de transação). Ficam de fora, de propósito, os escritores com bloqueio otimista por `version` (`link-settlement`, `platform-link-claim`, `platform-maintenance`, `sync-maquinetas` e os laços de retry do `process-dom-webhook`): gravam valor absoluto, tratam conflito pelo `count` e já logam com `before` vindo da versão lida. Migrá-los muda a semântica de concorrência.
- [x] Etapa 4: `wallet-ledger.integration.test.ts` (Postgres local descartável): cadeia encadeada, 12 créditos concorrentes, rollback e saldo absoluto.
- [x] Etapa 5: `backend/scripts/reconcile-wallets.ts` (somente leitura por padrão; `--apply` exige `--confirm-host`).
- [x] Etapa 6: 7 lacunas de saldo históricas fechadas com `ADJUSTMENT` / `RECONCILIATION` (Bosque 1, Renovada 5, `contato@simintermediacoes.com` 1, incluindo o par de R$ 996,36 entre Renovada e simintermediacoes). Carteiras intactas. Total de 8 linhas `RECONCILIATION` com a de `saut.pdc`.
- [ ] Lacunas de `lockedBalance` (14, só reportadas): saques de Renovada/Bosque são aprovados sem log do bloqueio anterior. Não geram diferença de saldo.
- [x] Etapa 7: `WalletConsistencyCron` (diário, 6h de São Paulo, somente leitura) registra cada carteira cujo saldo difere do fim do log; lançamentos `MASTER_ADMIN_CONTROL` são ignorados. Hoje aponta só `adminljl@simpay.com.br` (R$ 1.035,95), deixada de fora a pedido.
- [x] Etapa 8: `getWalletBalance` (com divergência contra o log) e `walletAmounts` (pura, sem consulta extra, usada pelo `/me`) concentram a regra `max(0, balance − lockedBalance)`. A leitura continua pela carteira. Só passa a ler o log depois de um período com a conciliação limpa.
- [x] Etapa 9: removidos o ramo por `Transaction` e `useRenovadaWalletLedger` do `get-me`, o cálculo por plataforma do helper e as fórmulas da composição administrativa (agora carteira + log por ação). `get-withdraw-summary` mantém a separação Renovada/Bosque só para taxas e configuração de saque.
- Pendências conhecidas: conta admin (R$ 1.035,95 de diferença), 14 lacunas de `lockedBalance` em Renovada/Bosque (saque aprovado sem log do bloqueio), carteira negativa de `dono@zerograusorvetesac.com` (R$ −13,31) e migrar para log como fonte de leitura após um período conciliado.

## Princípios

1. `BalanceLog` é append-only e é a fonte da verdade. `Wallet.balance` e `lockedBalance` são projeção materializada (leitura rápida e `version` para concorrência).
2. Toda mudança de saldo passa por um único serviço que atualiza a carteira e grava o log na mesma transação do banco. Não há escrita direta em `wallet`.
3. Divergência histórica entre carteira e log é corrigida por lançamento de ajuste (`action = ADJUSTMENT`, `source = RECONCILIATION`), nunca editando linhas antigas. O ajuste guarda motivo e metadata (valor da carteira antes, soma do log).
4. Sem fórmulas por plataforma. Saldo disponível é `max(0, balance − lockedBalance)` para qualquer conta, seja dona de plataformas, coprodutora, afiliada ou tudo isso. Taxas incidem no lançamento, não na leitura.

## Etapas

- [ ] 1. Auditar os escritores da carteira: tabela arquivo → grava log? → qual `action`/`source`. Registrar aqui o resultado.
- [ ] 2. Serviço único `WalletLedgerService.apply({ userId, balanceDelta, lockedDelta, action, source, transactionId?, metadata })`. Controle otimista por `version`, grava log na mesma transação, retorna o saldo posterior.
- [ ] 3. Migrar os escritores para o serviço, um módulo por commit: coprodução, afiliado, webhooks DOM/assinatura, saques (pedido, aprovação, rejeição), claims e settlements de link, sync Renovada/Bosque, maquinetas, manutenção administrativa.
- [ ] 4. Teste de integração por escritor: após a operação, `balanceAfter` do último log é igual a `wallet.balance` e as linhas encadeiam (`balanceBefore` de uma é `balanceAfter` da anterior).
- [ ] 5. Conciliação: comando somente leitura que lista as contas em que `wallet.balance` difere da soma do log, com o valor da diferença. Rodar primeiro em cópia ou leitura do banco; executar em banco remoto só com autorização explícita.
- [ ] 6. Backfill: para cada conta divergente, um lançamento de ajuste com a diferença. Revisão humana da lista antes de aplicar.
- [ ] 7. Trava de consistência: job periódico ou verificação em CI que falha quando a conciliação encontra divergência.
- [ ] 8. Leitura: `/me`, resumo de saque, painel e relatórios passam a uma só função `getAvailableBalance(userId)`. Primeiro ela lê a carteira e compara com o log (só alerta). Quando a conciliação ficar limpa por um período, passa a ler o log. A carteira continua como cache e trava de concorrência.
- [ ] 9. Remover `useRenovadaWalletLedger`, `computeUserNetBalance`, `RENOVADA_TAXA_SERVICO_DATE` e o ramo por `Transaction` do `get-me`. Atualizar `docs/business-rules.md`.

## Decisões em aberto

- Contas genéricas hoje mostram saldo por `Transaction × liquidez`. Com a leitura única, o número muda para quem tem divergência. Precisamos da lista da etapa 5 antes de decidir se o valor da carteira ou o do cálculo antigo é o correto para cada conta.
- As taxas de liquidez e de serviço por plataforma passam a ser aplicadas no lançamento. Definir se contas antigas precisam de ajuste retroativo (a data de vigência da taxa de serviço está fixa no código).
- A conciliação deve cobrir `lockedBalance` com o mesmo rigor, incluindo `CoproductionAllocation` em `LOCKED`.

## Restrições

- Nenhuma consulta de escrita, migração ou backfill no banco `vps.simintermediacoes.com` sem autorização explícita.
- Conciliação e relatórios só leem.
