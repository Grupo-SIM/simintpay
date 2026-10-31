# Reformulação de /admin/taxas: taxa única, adquirentes arbitrárias e lucro — frontend

Plano (aguardando aprovação). Parte backend: [../../simintpay-back/plans/0008-taxas-adquirentes-lucro.md](../../simintpay-back/plans/0008-taxas-adquirentes-lucro.md).
Contrato de API definido no plano do backend; este plano só consome.

## Problemas atuais

- Dois blocos de juros somados (adquirente + SimIntPay) e três pares fixo/%/juros por parcela: poluído e vertical.
- 12 cartões de parcela com "Composição" expansível; o lucro não aparece como número principal.
- `FinancialSimulationCard` chama a soma de adicionais de "Margem SimIntPay" sem confrontá-la com o custo efetivo da adquirente que processou; o lucro administrativo deve incluir **somente o excedente**, inclusive o excedente de juros.
- Falta de custo configurado na adquirente passa despercebido (causa do incidente de juros duplicados).

## Nova tela (admin e dono de plataforma)

1. **Cabeçalho**: seletor de plataforma + modalidade/canal (já existe) + aviso se alguma parcela não tem custo de adquirente (badge "sem custo — dobro do interno").
2. **Uma tabela, 1x–12x, em vez de 12 cartões** (linhas = parcelas, edição inline):
   - Colunas editáveis: _Nosso excedente_ (fixo, %, juros).
   - Colunas somente leitura: _Custo de referência_ (maior entre adquirentes ativas habilitadas, com nome), _Taxa cobrada_ (excedente + maior custo), _Comprador paga_, _Repasse estimado ao usuário_, _Lucro admin estimado_. Distinguir custo de referência na simulação do custo **efetivo** da adquirente que processou a transação.
   - Linha-resumo com lucro admin estimado para o valor de teste.
3. **Painel lateral "Simulação"**: valor de teste e, para a parcela selecionada: comprador paga (`T`) → taxas e juros SimIntPay (`C_sim`) → **repasse/lucro do usuário** (`T − C_sim`); custo de referência da adquirente (`C_adq`) → **lucro admin estimado** (`C_sim − C_adq`, incluindo excedente de juros). Nas transações concluídas, usar o custo real da adquirente processadora.
4. **Aba/seção "Adquirentes"** (admin): lista arbitrária (código, nome, ativa), edição de custo por modalidade/canal/parcela (fixo, %, juros), origem (manual | sincronizada), data da última sincronização, botão "Sincronizar agora" e histórico das últimas alterações sincronizadas (sem aprovação: aplicadas automaticamente).
5. Remover: bloco "Juros por parcela" duplo, "Composição" expansível, `FinancialBulkInterestField` (substituído por ação em lote "aplicar a todas as parcelas").
6. **Dono de plataforma**: vê apenas taxa cobrada, comprador paga e seu líquido; nunca custo da adquirente.

## Correção do lucro (cliente de plataformas)

- `FinancialSimulationCard`/`use-financial-simulation.ts`: separar **repasse/lucro do usuário** (`T − C_sim`) do **lucro admin** (`C_sim − C_adq`); o excedente de juros integra o lucro admin, mas o custo de juros da adquirente não. Usar campos distintos do backend, não um `profit` ambíguo.
- Rever telas de relatório que exibem "Lucro SimPay" (`LucroSimpayDetalhePanel`, `lucroPlataformaChart`, `consolidadoLucroMerge`) para usar lucro admin calculado com a adquirente que efetivamente processou.

## Etapas

- [ ] Tipos em `financial-types.ts` para o novo contrato (`referenceAcquirerCost`, `chargedRate`, `platformCharges`, `sellerPayout`, `estimatedAdminProfit`; nos pagamentos liquidados: `processedBy`, `actualAcquirerCost`, `actualAdminProfit`).
- [ ] Tabela de parcelas + painel de simulação (substitui `FinancialPolicyDraft` grid e `FinancialSimulationCard`).
- [ ] Seção Adquirentes com sincronização manual e histórico.
- [ ] Correção do lucro nos relatórios.
- [ ] Testes browser existentes (`financial-policy.browser.test.mjs`) atualizados; build.

## Decisões pendentes (ver plano do backend)

Fórmulas e roteamento foram definidos pelo usuário; validar na integração as diferenças entre simulação (custo de referência) e transação concluída (custo da adquirente processadora).
