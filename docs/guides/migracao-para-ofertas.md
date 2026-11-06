# Migrar os produtos legados para Ofertas

Guia para você migrar tudo. Os detalhes técnicos dos scripts estão em [offer-migration-runbook.md](offer-migration-runbook.md) e [subscription-migration-playbook.md](subscription-migration-playbook.md). Aqui está só o que você precisa fazer, na ordem.

## 1. O que muda

Planos, Planos por PIX, Links de pagamento, Links de assinatura e Boletos viram **Ofertas**. Uma oferta tem preço, meios de pagamento, recorrência, validade, limite de usos, entrega e coprodução, tudo no mesmo cadastro.

- A migração **cria** as ofertas a partir dos produtos legados. **Não apaga nem altera** nenhum produto legado.
- O código público de cada produto é preservado. A **URL muda** (`?oferta=<código>`) e **não há redirecionamento automático**. Você troca as URLs divulgadas.
- As recorrências passam a ser cobradas pela SimIntPay, não mais pela DOM.
- Cada script grava só com `--apply --i-understand-this-writes`. Sem isso, é sempre simulação.

## 2. Seu cenário hoje (consulta agregada, 2026-11-05)

| Produto                                     | Quantidade | Observação                                                                                   |
| ------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| Links de pagamento                          | 13         | 8 AREAFLIX, 3 SIMINTPAY, 1 GLOBAL, 1 Sim-Delivery. 8 têm `webhookUrl`, 1 tem texto de e-mail |
| Links de assinatura                         | 13         | 10 AREAFLIX, 3 RASTREWIN. 6 mensais e 7 anuais. Todos aceitam PIX e cartão                   |
| Boletos                                     | 1          | Vence em 3 dias                                                                              |
| Planos e Planos PIX                         | 0          | Nada a migrar                                                                                |
| Ordens de assinatura                        | 5          | Todas **PIX, anuais, pagas em 20 e 21/10/2026**, sem assinatura na DOM                       |
| Bumps, upsell, arquivos, cupons, comunidade | 0          | Nada que bloqueie a migração                                                                 |
| Acordos de coprodução                       | 3          | 1 num link de pagamento, 2 em plataformas                                                    |

**Boleto: não migre ainda.** O checkout de oferta ainda não emite boleto. Uma oferta de boleto existiria, mas não cobraria. Mantenha o boleto legado ativo. O script o bloqueia por padrão (`BLOCKED_BOLETO_CHARGE_UNSUPPORTED`).

**Links de assinatura: crie as ofertas, mas só troque as URLs depois da sandbox.** O cartão recorrente da oferta usa um token da DOM ligado ao cliente, e isso nunca foi testado contra a DOM real (seção 6).

## 3. Antes de começar

1. **Backup** do banco de produção.
2. **Ensaie em uma cópia local.** Suba um Postgres descartável, aplique as migrations com `migrate deploy` e rode os passos 4 a 6 nele.
3. **Aplique as migrations** no banco de produção (precisa da sua autorização). Veja o que está pendente com `prisma migrate status` e aplique:
   ```
   cd backend && DATABASE_URL=<produção> bunx prisma migrate deploy
   ```
   As cinco migrations desta entrega são `20261105120000_external_ref`, `20261105130000_offer_charge_core`, `20261106110000_stored_card_vault`, `20261107100000_coproduction_ofertas` e `20261108100000_stored_card_customer_id`. Todas só adicionam tabelas e colunas. O `migrate deploy` aplica também qualquer outra pendente.
4. **Variáveis de ambiente** do backend:
   - `RENEWAL_LINK_SECRET`: gere com `openssl rand -hex 32` (detalhes em `docs/deployment.md`).
   - `DOM_PUBLIC_KEY`: só para plataformas com token próprio na DOM.
   - `CHECKOUT_BASE_URL` (ou `SIMPAY_CHECKOUT_URL`): base dos links de renovação.
5. O usuário dono de cada produto **não pode ser administrador** (regra do plano 0009). Produtos de admin saem como `BLOCKED_ADMIN_OWNER`: transfira o produto para o dono real antes.

## 4. Passo a passo

Rode a partir de `backend/`. Em todos os comandos, `--database-url` é obrigatório e nunca é lido do `.env`.

**Passo 1: relatório (só leitura).**

```
bun --no-env-file scripts/offer-migration-report.ts --database-url=<url>
```

Mostra o que seria criado, o que seria recusado e o que está bloqueado. O relatório sai com erro enquanto houver bloqueio. Com `--allow-blocked` ele aceita os bloqueios que você já decidiu manter (por exemplo o boleto).

**Passo 2: simulação do apply (padrão, não grava).**

```
bun --no-env-file scripts/offer-migration-apply.ts --database-url=<url>
```

Confira cada linha `REFUSED` e `BLOCKED` (tabela da seção 5).

**Passo 3: aplicar.**

```
bun --no-env-file scripts/offer-migration-apply.ts --database-url=<url> --apply --i-understand-this-writes
```

É seguro repetir: o que já foi migrado é pulado.

**Passo 4: verificar.**

```
bun --no-env-file scripts/offer-migration-apply.ts --database-url=<url> --verify
```

Compara contagem, valor em centavos, código, dono, entrega (webhook, redirect e e-mail) e o vínculo com a DOM. Sai com erro se algo divergir.

**Passo 5: contratos das 5 ordens pagas por PIX.** Só depois de as ofertas dos links de assinatura existirem.

```
bun --no-env-file scripts/offer-contract-migration.ts --database-url=<url>
bun --no-env-file scripts/offer-contract-migration.ts --database-url=<url> --apply --i-understand-this-writes
bun --no-env-file scripts/offer-contract-migration.ts --database-url=<url> --verify
```

O primeiro comando é a simulação. O script confere que carteiras e `BalanceLog` não mudaram, e aborta se mudarem. Confira também se as 5 ordens têm o documento do comprador preenchido: sem ele, o link de renovação responde pedindo contato com o suporte.

**Passo 6: teste uma oferta de ponta a ponta.** Abra `?oferta=<código>` de uma oferta migrada e pague um PIX real de valor mínimo. Confira o valor, o webhook, o e-mail e a carteira.

**Passo 7: troque as URLs.** Troque o endereço divulgado (site, e-mail, campanha, integrações):

| Produto            | URL antiga                       | URL nova            |
| ------------------ | -------------------------------- | ------------------- |
| Link de pagamento  | `?simLinkCode=<id>`              | `?oferta=<código>`  |
| Link de assinatura | `?subscriptionLinkCode=<código>` | `?oferta=<código>`  |
| Plano              | `?simPlanCode=<código>`          | `?oferta=<código>`  |
| Boleto             | `?simBoletoCode=<id>`            | (mantenha o legado) |

**Passo 8: desative o produto legado** (`isActive = false`) quando a URL nova estiver no ar. Enquanto o legado estiver ativo, um cartão pago nele continua criando assinatura na DOM, que cobra por fora do agendador novo.

**Passo 9: acompanhe a primeira semana.** Veja o webhook de cada link com `webhookUrl`, as vendas novas na tela de Ofertas e, na primeira renovação, o aviso ao comprador.

## 5. Se o script recusar ou bloquear

| Código                                            | Significa                                                                         | O que fazer                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `BLOCKED_ADMIN_OWNER`                             | O dono é administrador                                                            | Transfira o produto para o cliente dono                            |
| `BLOCKED_BOLETO_CHARGE_UNSUPPORTED`               | Boleto ainda não cobra em oferta                                                  | Mantenha o legado. `--include-boleto` cria uma oferta inerte       |
| `BLOCKED_HAS_FUNNEL_OFFERS`                       | O link tem order bump, upsell ou downsell                                         | Recrie o funil como ofertas e ligue-as depois da migração          |
| `BLOCKED_HAS_FILES`                               | O link tem arquivos                                                               | Arquivos ainda não migram: mantenha o legado                       |
| `BLOCKED_HAS_VOUCHERS`                            | Há cupom ligado ao produto                                                        | Cupons ainda não existem em oferta: mantenha o legado              |
| `BLOCKED_HAS_COMMUNITY`                           | Há comunidade ligada                                                              | Acesso por comunidade ainda não migra: mantenha o legado           |
| `BLOCKED_HAS_PIX_ACCESS`                          | Plano PIX com compradores e dias de acesso                                        | O crédito de dias ainda não migra: mantenha o legado               |
| `BLOCKED_LIVE_DOM_SUBSCRIPTION`                   | Há assinatura viva na DOM cobrando                                                | Siga o cenário B do [playbook](subscription-migration-playbook.md) |
| `INVALID_FULFILLMENT`                             | Um webhook, redirect ou e-mail é inválido (por exemplo, endereço de rede interna) | Corrija o campo no produto legado e rode de novo                   |
| `INVALID_AMOUNT`, `MISSING_CODE`, `MISSING_OWNER` | Valor com fração de centavo, produto sem código ou sem dono                       | Corrija o produto legado                                           |
| `DUPLICATE_CODE`                                  | Dois produtos com o mesmo código                                                  | Renomeie um deles                                                  |

Um valor abaixo de R$ 14,99 só gera aviso, não bloqueio.

## 6. O que você precisa saber antes de trocar as URLs

- **Cartão recorrente:** o fluxo novo (token da DOM ligado ao `customer_id`, cobrado por nós a cada ciclo) está testado só com a DOM simulada. Faça um teste na sandbox da DOM antes de trocar as URLs dos links de assinatura que vendem no cartão. Os pontos a conferir estão no plano 0021.
- **Taxas por link:** as ofertas **ignoram** as taxas individuais do link (parcelas, cashback, débito) e usam a política financeira. O script avisa com `FEE_OVERRIDE_NOT_CARRIED` quando o link tinha uma taxa diferente do padrão. Confira esses links antes de migrar.
- **AREAFLIX:** o checkout de oferta aplica a mesma regra de líquido do link AREAFLIX.
- **Coprodução:** o acordo existente é preservado. Uma oferta migrada continua lendo o acordo do produto original.
- **Entrega:** o webhook de compra aprovada e estornada, o redirect e o e-mail são copiados. Webhooks para endereço de rede interna são recusados por segurança.
- **Histórico:** as vendas antigas continuam ligadas ao produto legado e aparecem nos relatórios como hoje. As vendas novas vêm da oferta.

## 7. Se algo der errado

Apagar as ofertas criadas é seguro enquanto nenhuma venda tiver sido feita nelas. O SQL está no runbook (seção Rollback). Os produtos legados nunca foram alterados, então basta voltar a divulgar a URL antiga e reativá-los. Os contratos do Passo 5 também são reversíveis: cada um guarda o id da ordem original e nenhum dinheiro se moveu.

## 8. Checklist final

- [ ] Backup feito e ensaio em cópia local concluído
- [ ] Migrations aplicadas em produção
- [ ] `RENEWAL_LINK_SECRET` (e `CHECKOUT_BASE_URL`) definidos
- [ ] Relatório sem bloqueios inesperados
- [ ] `--verify` do apply sem divergência
- [ ] Contratos das 5 ordens migrados e verificados
- [ ] Um PIX real de teste numa oferta migrada
- [ ] Sandbox da DOM validada antes de trocar os links de assinatura no cartão
- [ ] URLs trocadas e produtos legados desativados
- [ ] Boleto legado mantido ativo até o checkout de boleto existir
