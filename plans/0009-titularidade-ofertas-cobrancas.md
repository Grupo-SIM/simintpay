# Titularidade financeira e unificação de ofertas e cobranças

Plano proposto em 2026-10-29. Escopo desta entrega: investigação e planejamento; não implementar o modelo nem executar migrações remotas.

Relacionados: [0002 — plataformas explícitas](0002-explicit-owned-platforms.md), [0007 — ledger](0007-balance-ledger-source-of-truth.md) e [0008 — taxas, adquirentes e lucro](0008-taxas-adquirentes-lucro.md). O plano 0008 define o cálculo financeiro; este define a quem ele pertence e em quais entidades seu snapshot fica registrado.

## 1. Diagnóstico verificado

### Titularidade

- `CreatePaymentLinkUseCase.execute` consulta o usuário autenticado, valida a plataforma selecionada e persiste `userId: input.userId`. Selecionar a plataforma não substitui o titular pelo dono dela. O administrador que cria acaba sendo dono financeiro do link.
- `application/helpers/explicit-platform.helper.ts` permite seleção administrativa, mas exige plataforma quando uma conta possui mais de uma. Isso conflita com a solicitação de permitir venda pessoal sem plataforma, independentemente de quantas plataformas a pessoa possua.
- `PaymentLink`, `SubscriptionLink`, `Plan`, `PixCreditPlan` e `Boleto` têm `userId`, sem distinção consistente entre executor e titular. Plataforma aparece em formatos distintos: `plataformas`, `platformTag` e `tenantTag`.
- A configuração individual usa `CLIENT:<email>` em `platform-taxas.store.ts`; e-mail mutável não deve ser identidade contratual. `User.cpf` e `User.cnpj` já têm índices únicos, mas existem contas sem documento: a migração precisa de relatório de pendências, não de documentos inventados.
- Há conta cliente separada da administração para SIM Intermediações. O link APP Delivery Estação (`2fa81db4-401e-4e1a-b465-72520d6542b5`) exemplifica a inconsistência: tem plataforma associada, mas pertence ao admin. Confirmar o destinatário cadastrado antes de qualquer transferência; nome ou tag não bastam.

Inventário somente leitura levantado nesta tarefa, sujeito a mudança: 13 links de pagamento (10 administrativos), 13 links de assinatura (10 administrativos), 1 boleto administrativo, nenhum `Plan`, `PixCreditPlan` ou `Subscription`; 5 `SubscriptionLinkOrder`. Os produtos inventariados já têm alguma associação textual de plataforma. Isso reduz a migração de dados de planos, mas não elimina a necessidade de preservar os fluxos existentes.

### Por que a unificação não é apenas juntar tabelas

Há aproximadamente 6,3 mil linhas nos casos de uso desses cinco produtos, 2,1 mil nos controllers, 5,6 mil nos componentes principais de checkout e 9,1 mil nas páginas de gestão. São medidas de superfície, não estimativa de código que precisará mudar. Webhooks, gateway, settlement, permissões, relatórios, coprodução e entrega ampliam esse alcance.

- Link de pagamento: oferta pública, meios habilitados, validade, limite de usos, parcelamento, ofertas adicionais e entrega.
- Plano: recorrência contratada, tentativas e assinatura com estado próprio no gateway.
- Plano PIX: compra de tempo/créditos e concessão de acesso. Não presumir débito PIX automático: pagamento avulso que estende acesso é diferente de assinatura com cobrança automática.
- Link de assinatura: combina oferta pública e condições de assinatura, trial, primeira cobrança e limites de repetição; tem ordens e snapshots próprios.
- Boleto: cobrança nominal de um pagador, vencimento, multa, juros, desconto e artefatos do gateway. Não é necessariamente uma oferta pública reutilizável.
- `Cobranca` já existe como projeção de relatórios com origem e dados externos; não confundir essa projeção com um novo agregado financeiro.
- `modules/coproduction/coproduction.ts` já mapeia os tipos de produto para tabelas. Reaproveitar o contrato de acordos e snapshots, sem tratar o mapa como modelo universal pronto.

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

## 3. Arquitetura recomendada: composição, não uma megatabela

Nomes abaixo são conceituais, a validar no desenho do schema; não constituem migração pronta.

| Responsabilidade       | Modelo conceitual                                                       | Conteúdo                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Identidade do vendedor | `MerchantIdentity` ou extensão mínima de `User`                         | ID estável, usuário titular, documento normalizado/verificado, contexto contratual                                    |
| Oferta comercial       | `PaymentOffering`                                                       | titular, executor, plataforma opcional, código público, nome, preço, estado e meios permitidos                        |
| Condições              | componentes de preço, validade e recorrência                            | pagamento único, renovação manual de acesso, assinatura automática; frequência, trial, repetições e primeira cobrança |
| Pedido/cobrança        | agregado canônico de cobrança, com nome distinto da projeção `Cobranca` | pagador, valores/snapshots, vencimento, origem, titular congelado e estado                                            |
| Tentativa no gateway   | `PaymentAttempt`                                                        | método, adquirente, ID externo, chave de idempotência, resultado e artefatos específicos                              |
| Assinatura             | `BillingSubscription`                                                   | contrato, agenda, gateway, próxima cobrança, tentativas, pausa e cancelamento                                         |
| Entrega                | concessões de acesso/fulfillment existentes adaptadas                   | tempo/créditos, arquivo, comunidade e outros efeitos pós-pagamento                                                    |
| Contabilidade          | `Transaction`, `Wallet`, `BalanceLog` e alocações                       | liquidação, reserva, estorno e distribuição; não criar um segundo ledger                                              |

Uma oferta pode gerar muitas cobranças; uma cobrança pode ter várias tentativas, mas apenas a liquidação permitida pela política de idempotência. Uma assinatura gera cobranças por ciclo. Boleto avulso pode gerar cobrança sem oferta pública. Parcelamento de cartão é condição de pagamento, não recorrência. Prazo de acesso, vencimento da cobrança, expiração do link e fim da assinatura são conceitos separados.

Métodos específicos continuam em adaptadores: cartão exige autorização/tokenização e parcelamento; PIX tem código/expiração/confirmação; boleto tem linha digitável/PDF, vencimento e encargos. A abstração deve declarar capacidades suportadas pelo gateway e rejeitar combinações inválidas, não prometer todos os métodos em todos os produtos.

### Compatibilidade

- Manter rotas, IDs, códigos e URLs públicas existentes por adaptadores. Criar mapa único `(legacyType, legacyId) → canonicalId`, com unicidade; não trocar IDs externos da DOM.
- Migrar primeiro a resolução de titular e o contexto financeiro nos fluxos atuais. Unificação de persistência vem depois e não bloqueia a correção de propriedade.
- Preferir um único caminho de escrita por etapa. Durante compatibilidade, tabelas antigas podem ser projeções ou origem transitória; dual-write financeiro independente é proibido.
- Webhooks novos e legados convergem para processamento idempotente pelo mesmo ID externo/cobrança/tentativa/ciclo. Preservar autenticação, assinatura, transições válidas, reentrega e eventos fora de ordem.
- Preservar snapshots de coprodução e taxas, vínculos com transações, reembolsos, acesso, notificações e relatórios. O contrato de efeito único deve cobrir tanto dinheiro quanto entrega.
- A coluna `Transaction.platformTag`, já entregue com derivação inicial de TENANT, precisa ganhar precedência nos leitores. Auditar consultas que ainda extraem a descrição; após a migração, alterar a descrição não muda a associação e editar a coluna governa o agrupamento. A tag é classificação, não comprovação de dono ou autorização.

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

### Fase D — núcleo comum de cobrança

- [ ] Desenhar schema e contratos com centavos, estados, tentativas, idempotência e snapshots; não implementar outro motor de taxas além do 0008.
- [ ] Extrair emissão/consulta/cancelamento/liquidação de uma cobrança avulsa. Pilotar link de pagamento sem recorrência.
- [ ] Adaptar boleto e PIX avulso mantendo particularidades do gateway, vencimento e segurança do checkout.
- [ ] Unificar relatórios e associação de transação sem duplicar registros da projeção `Cobranca`.

### Fase E — ofertas e recorrência

- [ ] Migrar configuração comum dos links para ofertas; preservar códigos, arquivos, upsells, ofertas adicionais e regras de acesso.
- [ ] Adaptar planos PIX como pagamento e concessão de tempo, sem simular recorrência automática inexistente.
- [ ] Migrar planos e links de assinatura para contrato/agenda comum, preservando assinaturas DOM existentes, trial, primeira cobrança, retry, pausa/cancelamento e limites.
- [ ] Só desativar rotas/modelos antigos após migração dos consumidores, métricas de uso e compatibilidade comprovada. Rotas legadas ainda usadas não devem ser removidas por estarem antigas.

### Fase F — validação e retirada gradual

- [ ] Ensaiar migração em cópia local sanitizada, nunca executar testes contra banco remoto/compartilhado.
- [ ] Comparar contagens, IDs públicos, referências externas, totais financeiros e alocações. Leituras sombra não emitem cobranças nem créditos.
- [ ] Cenários de webhook duplicado/fora de ordem, concorrência de tentativas, timeout após aceite do gateway, retry de ciclo, reembolso parcial/total, expiração e cancelamento.
- [ ] Validar acesso horizontal entre contas, destino forjado, admin como titular, documento conflitante, mudança de e-mail e transferência de plataforma com assinatura ativa.
- [ ] Validar checkout e dashboard em navegador; alterações de traduções sincronizadas em todos os locales quando aplicável. Executar hooks e type-check/build dos pacotes afetados antes da integração.
- [ ] Rollout por capacidade/coorte com adaptadores reversíveis. Rollback não reemite cobrança nem desfaz ledger; schema aditivo permanece até retirada segura.

## 5. Dificuldade e esforço indicativo

Estimativas de engenharia para uma pessoa familiarizada com os repositórios, incluindo testes e revisão; não são prazo fechado. Dependem da qualidade dos dados, capacidades DOM e decisões comerciais.

| Entrega                                                                          | Complexidade | Faixa indicativa                       |
| -------------------------------------------------------------------------------- | ------------ | -------------------------------------- |
| Inventário, contrato de destino e mapa de pendências                             | média        | 2–4 dias úteis                         |
| Titular/executor, plataforma opcional, permissões e formulários nos cinco fluxos | média/alta   | 5–9 dias úteis                         |
| Identidade estável, aliases de taxas e ensaio de migração histórica              | alta         | 3–6 dias úteis, além de revisão humana |
| Núcleo avulso e adaptadores de link/PIX/boleto                                   | alta         | 7–12 dias úteis                        |
| Ofertas, recorrência, acesso, compatibilidade e regressão completa               | muito alta   | 10–20 dias úteis                       |

Ordem de grandeza: **2–4 semanas para corrigir titularidade e preparar migração**, e **6–10 semanas para uma unificação incremental completa**, sem contar esperas externas e a execução integral do plano 0008. Não somar esforço dos planos mecanicamente: identidade e snapshots se sobrepõem e devem ter um desenho compartilhado.

A persistência vazia de planos ajuda o backfill, mas não justifica apagar suas APIs nem dispensar testes de recorrência. O maior risco não é criar tabelas: é duplicar cobranças/créditos, mudar recebedores de contratos existentes ou perder compatibilidade de URLs e webhooks.

**Recomendação:** aprovar e executar primeiro A–C. Isso impede novos recebíveis no admin e corrige o destino sem esperar a unificação. Depois entregar D–F por fatias, mantendo o gateway e o ledger atuais atrás de contratos comuns. Não fazer reescrita simultânea dos cinco produtos.

## 6. Limites desta entrega

- Este documento não transfere produtos, não redistribui saldos e não aplica migrações.
- A migração já versionada de `Transaction.platformTag` deve continuar sem aplicação remota até autorização explícita.
- O saldo atual conciliado não comprova, por si só, que cada venda histórica foi atribuída ao titular correto. Essa é a auditoria separada das fases A e C.
