# Titularidade financeira, identidade fiscal e destino dos recebíveis

Plano proposto em 2026-10-29. Implementação autorizada em 2026-10-29, sem unificação de produtos e sem executar migrações remotas.

Relacionados: [0002 — plataformas explícitas](done/0002-explicit-owned-platforms.md), [0007 — ledger](0007-balance-ledger-source-of-truth.md) e [0008 — taxas, adquirentes e lucro](0008-taxas-adquirentes-lucro.md). O plano 0008 define o cálculo financeiro; este define a quem ele pertence e quem executou a operação. A unificação foi separada no [plano 0010](0010-unificacao-ofertas-cobrancas.md).

## 1. Diagnóstico verificado

### Titularidade

- `CreatePaymentLinkUseCase.execute` consulta o usuário autenticado, valida a plataforma selecionada e persiste `userId: input.userId`. Selecionar a plataforma não substitui o titular pelo dono dela. O administrador que cria acaba sendo dono financeiro do link.
- `application/helpers/explicit-platform.helper.ts` permite seleção administrativa, mas exige plataforma quando uma conta possui mais de uma. Isso conflita com a solicitação de permitir venda pessoal sem plataforma, independentemente de quantas plataformas a pessoa possua.
- `PaymentLink`, `SubscriptionLink`, `Plan`, `PixCreditPlan` e `Boleto` têm `userId`, sem distinção consistente entre executor e titular. Plataforma aparece em formatos distintos: `plataformas`, `platformTag` e `tenantTag`.
- A configuração individual usa `CLIENT:<email>` em `platform-taxas.store.ts`; e-mail mutável não deve ser identidade contratual. `User.cpf` e `User.cnpj` já têm índices únicos, mas existem contas sem documento: a migração precisa de relatório de pendências, não de documentos inventados.
- Há conta cliente separada da administração para SIM Intermediações. O link APP Delivery Estação (`2fa81db4-401e-4e1a-b465-72520d6542b5`) exemplifica a inconsistência: tem plataforma associada, mas pertence ao admin. Confirmar o destinatário cadastrado antes de qualquer transferência; nome ou tag não bastam.

Inventário somente leitura levantado nesta tarefa, sujeito a mudança: 13 links de pagamento (10 administrativos), 13 links de assinatura (10 administrativos), 1 boleto administrativo, nenhum `Plan`, `PixCreditPlan` ou `Subscription`; 5 `SubscriptionLinkOrder`. Os produtos inventariados já têm alguma associação textual de plataforma. Isso reduz a migração de dados de planos, mas não elimina a necessidade de preservar os fluxos existentes.

## 2. Regras de negócio propostas

### Executor, titular e recebedores

1. `createdByUserId` identifica quem executou a criação; `ownerUserId` identifica o vendedor/titular financeiro. Atualizações e transferências têm auditoria própria. Nunca usar o executor como fallback silencioso do titular.
2. Conta `ADMIN` não pode ser titular de plataforma, oferta, cobrança, assinatura ou participante beneficiário. Administração operacional não recebe repasse de venda em sua carteira. A margem da empresa é contabilidade da SimIntPay, conforme 0008, não saldo pessoal do login administrativo.
3. Criação pelo administrador exige destino explícito: **usuário não administrativo ou plataforma com dono não administrativo**. Plataforma não é obrigatória quando se escolhe diretamente um usuário; o que é obrigatório para admin é escolher o destino, não criar uma plataforma fictícia.
4. Selecionar plataforma resolve seu dono no servidor. Se o pedido também informar um titular incompatível, rejeitar; não escolher um dos dois silenciosamente. Validar conta/plataforma ativas e autorização sobre cada operação.
5. Usuário comum pode criar para si, com plataforma opcional mesmo tendo várias. Sem plataforma, a identidade e as taxas são as da própria conta. Selecionar plataforma alheia não é permitido; vínculos delegados existentes exigem permissão explícita para agir pelo titular e registro do executor.
6. CPF/CNPJ é o documento fiscal do vendedor, não do administrador executor nem do comprador. Normalizar e validar; usar ID interno estável para relações e documento único para vinculação fiscal. Não usar documento como chave pública, não expor integralmente em listagens nem permitir troca para assumir identidade alheia.
7. Primeiro preservar a relação atual de um usuário com sua identidade fiscal. Suporte futuro a várias empresas por login é uma decisão separada; não introduzir associação muitos-para-muitos sem necessidade comprovada.
8. SIM Intermediações vende por sua conta cliente empresarial, com seu documento e acordo de coprodução explícitos. Não inferir propriedade empresarial por nome, e-mail, token, `SIMINTPAY`, `GLOBAL` ou descrição.
9. Coprodução/afiliado são destinos de distribuição do líquido, não substitutos do titular. O dono pode receber simultaneamente por vendas próprias e por participação em outras vendas.
10. Transferência de plataforma/produto não altera cobranças já emitidas, snapshots, recebedores ou logs históricos. Definir vigência explícita para novas cobranças e para assinaturas existentes; não mudar o beneficiário de uma renovação silenciosamente.

### Taxas e identidade

- Introduzir contexto contratual estável por titular/identidade fiscal, com edição de taxas restrita ao admin e auditoria/versionamento. Cadastro por documento deve resolver o titular, não criar outra carteira automaticamente.
- Compor políticas conforme o motor do plano 0008. Tornar a precedência explícita e testada: override específico da plataforma, se houver → contrato do titular → GLOBAL → padrão. Zero é override válido; ausência herda. Não copiar tabelas de taxas para cada novo produto.
- Migrar `CLIENT:<email>` mediante mapa revisado para IDs estáveis; manter aliases de leitura durante a transição. Mudança de e-mail não muda taxas. Troca de documento é processo auditado, sem reatribuição automática de histórico.
- Cobrança congela titular, documento fiscal necessário à emissão, contexto de plataforma, versão financeira, adquirente, valores em centavos e acordo de distribuição. Configuração atual nunca recalcula venda liquidada.
- Documento do pagador continua separado do documento do vendedor. Dados sensíveis seguem os limites de acesso e minimização existentes.

## 4. Execução incremental

### Fase A — inventário e decisões de migração

- [ ] Inventariar os cinco produtos, seus DTOs/controllers/repositórios, criação administrativa, rotas de integração, tokens, webhooks, relatórios e consumidores frontend/checkout.
- [ ] Relatório somente leitura por produto: executor conhecido/desconhecido, titular atual, plataforma cadastrada/dono, documento, taxas, transações, alocações, assinaturas e referências DOM.
- [ ] Listar contas sem documento, tags sem cadastro, conflitos de dono e beneficiários administrativos. Resolver em mapa revisado; nunca inferir executor histórico a partir de `userId` quando esse campo misturava papéis.
- [ ] Revisar APP Delivery Estação e demais produtos do admin. Separar transferência de propriedade futura de correção financeira histórica.
- [ ] Aprovar contrato de destino e política de vigência nas renovações. Registrar dependências do plano 0008 antes de mudar precedência financeira.

### Fase B — corrigir titularidade sem reescrever os produtos

- [ ] Criar resolvedor comum de executor/titular/plataforma/identidade; usá-lo nos cinco fluxos e APIs de integração, inclusive edição, clonagem, cobrança recorrente e importações.
- [ ] Acrescentar campos de auditoria e destino compatíveis com os contratos atuais. Em novas vendas, `userId` legado, quando ainda usado para liquidação, deve refletir o titular, não o executor.
- [ ] Bloquear admin como dono e beneficiário também na camada de domínio/serviço; não depender somente do formulário.
- [ ] Ajustar formulários: admin escolhe usuário ou plataforma; usuário comum pode optar por venda própria sem plataforma. Preservar seletor de contexto e permissões em edição/listagem.
- [ ] Associar identidade e política por IDs estáveis; migrar aliases `CLIENT:<email>` e validar documentos antes de habilitar novas emissões que os exijam.
- [ ] Adicionar testes de autorização, criação e liquidação para cada produto, incluindo coproprietário/afiliado que também possui plataformas.

### Fase C — reconciliação de propriedade histórica

- [ ] Script dry-run exporta propostas, ambiguidades e contagens; aplicação exige mapa aprovado, transação e auditoria com antes/depois. Migração de schema e execução remota dependem de autorização separada.
- [ ] Transferir produtos identificados preservando IDs e referências; manter o executor histórico desconhecido quando não houver evidência.
- [ ] Não transferir automaticamente transações liquidadas nem recalcular taxas/coprodução pelo dono atual. Correção monetária exige decisão específica, lançamentos compensatórios e verificação de duplicidade.
- [ ] Considerar que a carteira administrativa foi zerada por autorização operacional: isso não prova quitação dos verdadeiros vendedores nem autoriza recrédito. Conferir repasses externos, créditos já recebidos e ajustes anteriores antes de propor compensações.
- [ ] Migrar leitores de plataforma para `Transaction.platformTag` com política de compatibilidade explícita. Validar alterações manuais de tag sem alterar titular ou ledger.
- [ ] Conferir conservação de dinheiro, encadeamento do ledger, bloqueios e total por beneficiário antes/depois.

## 5. Verificação e esforço

Validar os cinco fluxos existentes sem alterar seus modelos de produto: criação e edição administrativa para usuário/plataforma, titular incompatível rejeitado, usuário comum sem plataforma mesmo possuindo várias, membro delegado sem apropriação de recebíveis, taxas preservadas após mudança de e-mail, documentos conflitantes, coprodução e imutabilidade do histórico. Testes somente em banco local descartável, hooks e type-check/build dos pacotes afetados, com validação visual dos formulários.

Estimativa preliminar: 2–4 semanas para titularidade, identidade/taxas e preparação da migração, incluindo testes; revisão humana de destinos históricos pode ampliar o prazo. Unificação de produtos, recorrência e cobrança fica exclusivamente no [plano 0010](0010-unificacao-ofertas-cobrancas.md).

## 6. Limites desta entrega

- Este documento não transfere produtos, não redistribui saldos e não aplica migrações.
- A migração já versionada de `Transaction.platformTag` deve continuar sem aplicação remota até autorização explícita.
- O saldo atual conciliado não comprova, por si só, que cada venda histórica foi atribuída ao titular correto. Essa é a auditoria separada das fases A e C.
