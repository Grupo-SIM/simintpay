# Unificação de taxas, juros e simulação

Plano aprovado pelo usuário. Execução exclusivamente local nos repositórios
`simintpay-front` e `simintpay-back`; migrações externas e publicação excluídas.

## Execução

- [x] Motor financeiro preciso, configuração versionada, auditoria e contratos.
- [x] Integrar prévia, cobrança e liquidação sem duplicar custos.
- [x] Admin e dono: composição autorizada, adicionais e juros separados.
- [x] Simulação incremental com debounce, cache e isolamento por linha.
- [x] Validar modalidades/canais, permissões, arredondamento, checkout e edição.
- [x] Atualizar regras, executar builds/testes e criar commits locais atômicos.

## Registro

- 2026-10-19: inspeção confirmou cálculos legados distintos por fluxo. Backend
  contém alteração prévia em `scripts/diagnose-checkout-platforms.sql`, fora desta entrega.
- Autorizada escrita local nos dois repositórios, incluindo Git.
- Implementação em andamento: revisões imutáveis, centavos e taxas em milionésimos;
  ativação explícita por adquirente/modalidade/canal/parcela, sem inferir juros legados.

## Implementação concluída

- Backend: motor puro Decimal, revisões append-only, origem/herança, zero explícito,
  autorização revalidada, ativação contratual completa e migração auditável.
- Mesma política integrada a links, boleto, PIX, checkout, pagamentos de plataforma,
  planos, assinaturas e importação POS. Snapshots preservam revisões contratadas;
  liquidação final e estorno não descontam custos novamente.
- Admin configura contratos por modalidade/canal e tabela de crédito 1x–12x.
  Dono configura adicionais independentes, repasse e opção sem juros. Composição
  interna restrita ao admin; diferença do dono não recebe rótulo de lucro.
- Simulação incremental: debounce 300 ms, cache por versão/rascunho, preservação
  de linhas independentes e proteção contra respostas atrasadas.
- Commit backend `afe7372`: motor, contratos, migração e testes.
- Commit backend `79cf1d1`: integração de cobrança/prévia/liquidação e regras.

## Validação local

- Suíte backend: **102 testes**, **680 asserções**, nenhuma falha.
- PostgreSQL temporário em loopback: migração sobre schema anterior e fixture
  histórica; integração passou com **12 asserções** sobre auditoria, preservação,
  igualdade simulação/cobrança, liquidação única, estorno, recorrência congelada e POS.
- Navegador Chrome com API local simulada: **15 asserções**; edição de uma parcela,
  resposta atrasada, campo inválido preservando demais linhas, falha isolada/retry,
  descarte, salvamento e mudança de valor.
- Builds finais backend e frontend aprovados, incluindo verificação TypeScript.
  Frontend usa respostas locais de fontes Google para funcionar sem rede.
- Commits normais, sem bypass de hooks. Repositórios não têm hooks ativos nem
  configuração Lefthook instalada; builds incluem verificação TypeScript.
- Repetição do teste de navegador precisou ampliar timeout de 120 para 240 segundos
  sob pressão de memória/swap; passou em 189 segundos com todas as asserções.
- SQL previamente staged do usuário preservado fora dos commits.

## Operação posterior

Migração preparada e validada somente localmente. Nenhuma publicação, push ou
alteração externa. Contratos reais devem ser cadastrados antes de ativar novas
modalidades; até ativação explícita, caminhos legados continuam operando.

- PostgreSQL temporário encerrado após validação. Frontend sem alterações pendentes;
  backend conserva somente SQL previamente staged do usuário. Commits usam Aran Leite
  como autor/committer e trailer de coautoria Codex.
