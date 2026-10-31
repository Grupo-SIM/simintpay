# Co-produção — contrato de integração

## Estado desta entrega

Interface implementada neste repositório, nos formulários de cliente e administração de links de pagamento, links de assinatura, boletos, planos e planos PIX. Configuração acessível em “Co-produção” desde a criação, com vários coprodutores e percentuais individuais. No cadastro, “Aplicar coprodutores” mantém um rascunho; salvar o produto envia produto e divisão na mesma requisição. Configuração tem salvamento próprio; descartar o formulário de produto não desfaz uma co-produção já salva.

Backend local `simintpay-back` implementa persistência, snapshots privados, distribuição transacional nas carteiras, renovação e reversões. Migração adiciona `CoproductionAgreement`, `CoproductionRevision` e `CoproductionAllocation`; campos financeiros existentes guardam os snapshots. Nenhum banco externo foi alterado.

Base: líquido após taxas, em centavos. Cada beneficiário recebe a parte inteira inferior de sua fração em centavos; proprietário recebe restante, inclusive resíduo. Contas são resolvidas pelo e-mail no cadastro e persistidas por ID.

## Endpoints autenticados

`GET /coproducao/:product/:id`

`PUT /coproducao/:product/:id`

`product` aceita apenas `links-pagamento`, `links-assinatura`, `boletos`, `planos` e `planos-pix`. IDs e tipos são codificados como segmentos de URL.

GET retorna:

```json
{
  "data": {
    "basis": "NET",
    "version": 0,
    "participants": []
  }
}
```

Somente um GET bem-sucedido com essa estrutura permite tratar a configuração como vazia. `404` significa produto não encontrado ou funcionalidade indisponível; não equivale a `participants: []`.

PUT recebe configuração completa:

```json
{
  "basis": "NET",
  "version": 0,
  "participants": [
    { "email": "parceiro@empresa.com.br", "percentageBps": 2550 }
  ]
}
```

`percentageBps` é inteiro: `2550` = 25,50%, `1` = 0,01%, `10000` = 100%. Participação individual deve estar entre 1 e 10000; soma não pode superar 10000. E-mails são normalizados com trim e lowercase; duplicidades e participação do próprio dono são rejeitadas. Lista vazia remove a configuração para futuras cobranças.

PUT retorna `{ "data": { ...configuraçãoPersistida } }`, com versão incrementada e os mesmos participantes persistidos. Frontend verifica resposta antes de confirmar sucesso. Atualização deve ser atômica e usar comparação de versão; versão obsoleta retorna `409`. Recarregar após conflito substitui explicitamente o rascunho pela configuração atual. Falha comum de gravação preserva o rascunho para nova tentativa.

## Recebimentos do coprodutor

`GET /coproducao/recebimentos?page=1`

Exige sessão de cliente aprovado. Consulta somente participações da própria conta em produtos de outros donos, sem precisar de plataforma própria. Retorna `data`, `summary`, `total`, `page` e `pageSize` (10). Cada item contém `transactionId`, `amountCents`, `state` (`AVAILABLE`, `LOCKED`, `REVERSED`), `createdAt` e `product`; não expõe comprador, e-mails dos participantes ou configuração privada.

`summary` contém `creditedCents`, `lockedCents` e `reversedCents`, históricos. Saques não são subtraídos desses totais; saldo para saque vem da carteira comum. Paginação não afeta totais. Resposta usa `Cache-Control: no-store`.

## Processamento financeiro

- Configuração não movimenta dinheiro. Validação de sessão, aprovação e propriedade ocorre no servidor; administrador usa papel atual do banco. Tokens de integração não acessam endpoints interativos.
- Revisões são auditadas; gravações concorrentes com mesma versão produzem uma vencedora e um conflito 409. Nenhuma atualização parcial da lista.
- Cobranças de links/boletos/planos PIX guardam divisão no snapshot antes de gerar pagamento. Pedidos de assinatura e assinaturas locais são persistidos antes da chamada de criação no gateway; falha deixa intenção sem crédito, com estado de falha.
- Políticas financeiras existentes são preservadas; cobranças legadas sem política guardam valores financeiros usados na nova assinatura. Renovação usa snapshot original, sem consultar nova configuração de coprodutores.
- Liquidação usa comparação de status, distribuição persistida por venda/beneficiário, atualização de carteira e auditoria na mesma transação. Reenvio de webhook, resposta síncrona e reconciliação não duplicam crédito. Ordem estável de carteiras reduz conflitos entre vendas concorrentes.
- Mediação, liberação, estorno e chargeback usam distribuição original. Reversão não recalcula taxas nem percentuais, nem limita débito ao saldo atual: saque anterior não elimina obrigação de estorno.
- Relatórios do dono descontam a participação distribuída aos parceiros do líquido atribuído, mantendo taxas efetivas separadas. Recebimentos dos parceiros têm consulta própria no relatório.
- Sem repasse retroativo e sem dados privados de coprodução nos checkouts públicos.

## Validação local

Testes de interface simulam API para os cinco produtos, edição/descarte, erros e conflitos. Testes financeiros usam PostgreSQL temporário exclusivamente local; cobrem autorização nos cinco tipos, concorrência, centavos/resíduo, liquidação única, rollback, renovação, mediação/liberação, estorno e chargeback. Gateways reais, CI, deploy e bancos compartilhados não são executados.

Migração local: `simintpay-back/prisma/migrations/20261021000000_coproduction/migration.sql`. Aplicação no ambiente de produção fica a cargo do responsável.

## Coprodutores no cadastro

Os cinco endpoints de criação aceitam `coproduction: { basis: "NET", version: 0, participants: [{ email, percentageBps }, ...] }` opcional. O proprietário é determinado pelo fluxo autenticado existente, nunca pelo objeto de coprodução. Validação de contas, criação local do produto, acordo inicial (versão 1) e revisão compartilham transação; erro não deixa produto local sem a divisão enviada. Falha no cadastro preserva rascunho no formulário. Produtos existentes continuam usando GET/PUT versionados.

## Notificações por participação

Venda com coprodução gera um evento privado para cada beneficiário, incluindo proprietário, com o valor exato persistido em `CoproductionAllocation.amount`. As entregas vão somente aos dispositivos opt-in da respectiva conta ativa/aprovada. Exemplo: líquido de R$ 90,01 com participações de 30% e 20% notifica R$ 27,00, R$ 18,00 e R$ 45,01 para o proprietário. Precisão e resíduo seguem a liquidação.

Evento e entregas são criados na mesma transação do crédito. Unicidade por venda/beneficiário impede duplicidade; liberação de mediação não é nova venda. Histórico anterior não gera avisos retroativos. Comprador e demais participantes não aparecem no payload. É necessária a migração `202610210001_coproduction_push`, entregue para aplicação no ambiente pelo responsável.

### Seleção de coprodutores

O modal usa linhas com percentual à esquerda, select de conta ao centro e exclusão no final. Não há submodal. Conta selecionada mostra nome e e-mail. O select lista contas ao abrir e pesquisa nome OU e-mail, sem diferenciar maiúsculas, com debounce e paginação de 20 contas. `GET /coproducao/contas?search=&page=1` exige sessão aprovada ou administrador ativo e retorna somente `id`, `name`, `email` de clientes aprovados, ativos e não excluídos; omite a própria conta. Resposta sem cache. Produto existente também retorna nomes atuais dos participantes. Nomes são apenas apresentação; gravação usa e-mail e percentual validados pelo servidor.

## Padrão por plataforma

`GET/PUT /coproducao/plataformas/:platformId` usa sessão do dono aprovado ou
administrador ativo. Tokens de integração não configuram divisões. Identidade é
validada no banco, sem confiar em proprietário enviado no corpo. Formato mantém
`basis: "NET"`, `version` e participantes em basis points (500 = 5%). Plataforma
aceita apenas `mode: "OWN"`; cada empresa Delivery deve ter plataforma própria.
Plataforma histórica compartilhada bloqueia configuração com participantes até
regularização explícita. Nenhum acordo ou beneficiário é habilitado automaticamente.

Cinco produtos herdam a plataforma efetivamente usada pela cobrança quando não há
acordo próprio ou `mode: "INHERIT"`. Acordo `OWN` prevalece, inclusive lista vazia
(desativa repasse). PUT antigo sem `mode` significa `OWN`. Voltar à herança usa PUT
versionado com `mode: "INHERIT", participants: []`; revisões não são apagadas.
GET acrescenta `mode` e `effective: { source, participants } | null`, para consulta
interativa. Esses dados privados não integram checkout nem callbacks da integração.
Produtos sem plataforma efetiva não herdam. Assinaturas existentes não são recalculadas.

Vendas canônicas diretas usam acordo da plataforma; quando informam link, acordo
próprio do link tem prioridade. Coprodutores recebem frações inteiras em centavos;
restante pertence ao beneficiário financeiro original da venda. Se esse beneficiário
constar no padrão herdado, sua parcela integra residual, sem crédito duplicado.

### Base dos itens no Delivery

Delivery envia `allocation.itemsAmountCents` (itens após cupom/cashback/pontos) e
`allocation.deliveryAmountCents` (frete). Ambos não negativos; soma corresponde a
`merchantAmountCents`. São apenas valores comerciais, nunca configuração de repasse.
Com acordo ativo, detalhamento é obrigatório antes de chamar adquirente. Ausência
retorna `COPRODUCTION_BASE_REQUIRED`; inconsistência, `COPRODUCTION_BASE_INVALID`.

Itens líquidos R$ 100 + frete R$ 10 + taxa R$ 5,37: comprador paga R$ 115,37;
coprodutor a 5% recebe R$ 5; empresa recebe R$ 105; taxa permanece R$ 5,37.
Nos cinco produtos existentes, base permanece líquido após taxas. Snapshot registra
base elegível, origem/versão e beneficiários antes da cobrança; alterações posteriores
não afetam repetição, renovação, mediação ou reversão. `netAmount` continua líquido
empresarial antes dos parceiros; relatórios descontam participações separadamente das taxas.

### Publicação

Aplicar migration `20261023000000_platform_coproduction` e backend SimIntPay primeiro;
publicar Delivery com migration `20261023000000_payment_item_breakdown` e novo
detalhamento; publicar interface SimIntPay; auditar vínculos e só então configurar
acordos. Campos novos são aditivos. Tentativas antigas conservam contrato original,
sem preenchimento retroativo. Não mover saldos ou reescrever histórico. Validação da
implementação usa exclusivamente gateways simulados e PostgreSQL local isolado.

## Visibilidade para coprodutores (somente leitura)

- A visibilidade dos produtos acompanha o acordo efetivo: acordo próprio (`mode: "OWN"`) substitui a configuração da plataforma, inclusive quando não há participantes; ausência de acordo próprio ou `INHERIT` utiliza a configuração da plataforma. Listagens incluem os produtos compartilhados com o usuário e retornam `coproducao: { role: "OWNER" | "COPRODUCER", readOnly, participantsCount, myPercentageBps } | null`. `myPercentageBps` só é preenchido para coprodutor; nenhum e-mail ou percentual de terceiros é exposto. Edição, status e exclusão continuam restritos ao dono no servidor.
- `GET /transacoes` inclui vendas em que o usuário tem `CoproductionAllocation`, e `GET /transacoes/:id` permite a transação completa, somente leitura. Ambos retornam `coproducao: { role, readOnly, product, myAmountCents, state } | null`, com o valor exato da alocação do usuário.
- `GET /relatorios/dashboard` e o dashboard do cliente (`/admin/plataformas/cliente/dashboard`) retornam `coproducao: { count, creditedCents, lockedCents, reversedCents }` no período, apenas para participações em produtos de terceiros. O líquido das vendas próprias desconta as parcelas dos coprodutores; a participação em vendas de terceiros aparece separadamente, nunca como receita integral da venda. Valores informativos: já integram a carteira.
- O catálogo de plataformas inclui aquelas cujo acordo de plataforma lista o usuário como coprodutor, com identificação básica e `coproducao.readOnly: true`, sem configurações privadas. Configuração, taxas, credenciais e demais operações administrativas continuam exclusivas do dono/administrador.
- Os relatórios financeiros e recebimentos de coprodução respeitam os filtros de período, plataforma e meio de pagamento. Selecionar uma plataforma compartilhada não libera o resultado financeiro do dono: exibe somente a participação do usuário, separada das vendas próprias. Clientes, neste contexto, são usuários da área do cliente; as permissões de cadastro de compradores não são ampliadas.
