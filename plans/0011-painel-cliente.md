# Painel do cliente: edição, layout e notificações

Plano aprovado em 14/10/2026. Implementação local; nenhuma publicação, migração remota ou envio externo autorizado.

## Etapas

- [x] Padronizar cinco listagens/formulários com apresentação compartilhada e edição via `?id=`; preservar campos adicionais e links públicos, mínimo R$ 14,99.
- [x] Bloquear montagem de rotas administrativas, comunidades e plataformas para clientes; validar aprovação, propriedade e campos protegidos no backend.
- [x] Adicionar controle de Web Push por dispositivo, service worker, cadastro autenticado e remoção antes de logout/troca de conta.
- [x] Persistir evento da primeira aprovação na transação de venda e entregas únicas por dispositivo; processar retries/expiração sem interromper pagamento.
- [x] Adicionar migração Prisma e configuração VAPID locais; validar com provedor simulado e testes locais dos projetos afetados.
- [x] Registrar regras de produto e escopo futuro, concluir commits atômicos com identidade Git local.

## Critérios de aceite

Edição dos cinco produtos carrega dados antes de salvar, permite descartar, preserva preenchimento em erro, oferece retry no carregamento, mantém identidade/link e campos não editáveis. Conta pendente/rejeitada e IDs de terceiros não autorizam alterações. Rotas vedadas não montam páginas nem consultas.

Push requer clique explícito e cliente aprovado; negação e incompatibilidade possuem feedback. Remoção por dispositivo precede logout. Eventos incluem criação já COMPLETED, webhooks repetidos e reconciliação, sem backfill histórico. Entregas múltiplas são independentes; falhas temporárias usam backoff; 404/410 removem assinatura. Notificação contém somente título/valor e abre /transacoes.

## Validação e limites

Testes relevantes, hooks existentes e build local. Validar temas e viewport por ferramentas locais disponíveis; registrar limites observados. Não usar configuração de banco existente sem comprovar destino local. Publicação, testes com provedor real e migração remota dependem de pedido específico.

## Progresso

- Inspeção inicial: frontend Next.js, backend NestJS/Prisma; estruturas reais diferem dos exemplos globais Elysia/TanStack.
- Em implementação: edição, guardas e Web Push. Backend permite escrita somente com escalonamento de sandbox aprovado.

- Guardas frontend implementadas; testes cobrem acesso direto e rotas operacionais não liberadas. Web Push frontend concluído no commit `fe6b258`; dez testes simulados passaram.
- Listagens padronizadas com tabela compartilhada do admin, filtros, paginação e retry; cinco testes de contratos/rotas passaram. Formulários em validação.

- Formulários cliente concluídos: `?id=`, payloads restritos, descarte, skeleton/retry, debounce com flush no blur, metadados PIX preservados. Apresentação extraída em componentes compartilhados. Sete testes frontend de contratos/rotas/metadados passaram; validação de navegador/build em andamento.

- Build webpack isolado passou com fontes locais simuladas; type-check posterior passou. Navegador local revelou hidratação divergente no shell ao ler cookie no primeiro render; correção prepara estado inicial igual no servidor/navegador. Validação visual continuará após rebuild.
- Acrescentados testes reais de navegador (API inteiramente simulada e requisições não locais bloqueadas), IDs estáveis em linhas para não transportar confirmação entre registros, e preservação de frequência legada não alterada.

## Entrega concluída

- Backend: evento transacional e fila por dispositivo, retries/leases/expiração, contratos autenticados e proteção de aprovação/propriedade/vínculos concluídos. Integração com Prisma revelou retorno PostgreSQL `void` no advisory lock; cast corrigido e teste real passou.
- Banco descartável em localhost: todas as 56 migrações aplicadas. Provedor Push simulado; nenhum envio externo. Quatro suítes finais backend passaram (35 testes), além das suítes de produtos e regressão executadas durante implementação.
- Frontend: 20 testes unitários passaram. Três suítes reais Chromium passaram: edição dos cinco produtos e erros, URLs restritas/aprovação, dez telas em desktop/mobile e claro/escuro; 40 capturas locais.
- Build frontend isolado webpack e type-check passaram; fontes Google substituídas por fontes locais somente na cópia de validação. Build mantém aviso preexistente de trace do manifesto da página marketing. Backend build e verificação de tipos concluídos.
- Regras de produto documentadas nos dois projetos. Plano 0002 registra paridade operacional futura. Commits locais usam autor/committer configurados e trailer Codex. Alterações independentes de preview de links preservadas.
- Limites: entrega real depende de configurar VAPID/migração no ambiente de destino e publicar frontend/backend. Sem provedor real, migração remota, deploy ou push nesta execução.
