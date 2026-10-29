# Unificação de ofertas e cobranças

Plano futuro, separado em 2026-10-29 por solicitação do usuário. **Fora da implementação atual.** Depende da titularidade do [plano 0009](0009-titularidade-ofertas-cobrancas.md) e dos cálculos do [plano 0008](0008-taxas-adquirentes-lucro.md). Nenhuma migração remota autorizada.

### Por que a unificação não é apenas juntar tabelas

Há aproximadamente 6,3 mil linhas nos casos de uso desses cinco produtos, 2,1 mil nos controllers, 5,6 mil nos componentes principais de checkout e 9,1 mil nas páginas de gestão. São medidas de superfície, não estimativa de código que precisará mudar. Webhooks, gateway, settlement, permissões, relatórios, coprodução e entrega ampliam esse alcance.

- Link de pagamento: oferta pública, meios habilitados, validade, limite de usos, parcelamento, ofertas adicionais e entrega.
- Plano: recorrência contratada, tentativas e assinatura com estado próprio no gateway.
- Plano PIX: compra de tempo/créditos e concessão de acesso. Não presumir débito PIX automático: pagamento avulso que estende acesso é diferente de assinatura com cobrança automática.
- Link de assinatura: combina oferta pública e condições de assinatura, trial, primeira cobrança e limites de repetição; tem ordens e snapshots próprios.
- Boleto: cobrança nominal de um pagador, vencimento, multa, juros, desconto e artefatos do gateway. Não é necessariamente uma oferta pública reutilizável.
- `Cobranca` já existe como projeção de relatórios com origem e dados externos; não confundir essa projeção com um novo agregado financeiro.
- `modules/coproduction/coproduction.ts` já mapeia os tipos de produto para tabelas. Reaproveitar o contrato de acordos e snapshots, sem tratar o mapa como modelo universal pronto.

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

**Recomendação:** executar primeiro a titularidade do plano 0009. Isso impede novos recebíveis no admin e corrige o destino sem esperar a unificação. Depois entregar as fases D–F deste plano por fatias, mantendo o gateway e o ledger atuais atrás de contratos comuns. Não fazer reescrita simultânea dos cinco produtos.
