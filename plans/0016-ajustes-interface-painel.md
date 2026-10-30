# Ajustes de interface e filtros do painel

Plano aprovado. Execução exclusivamente local em `simintpay-front` e `simintpay-back`.

- [x] Navegação, vendas, aviso de saques e prévia dos planos.
- [x] Descrição TENANT apenas na apresentação e adquirentes exclusivos do admin.
- [x] Pesquisa em seletores administrativos de plataformas.
- [x] Contas: itens criados, documentos, plataformas em modal e cadastro em modal.
- [x] Relatórios: taxas SimIntPay antes de adquirentes.
- [x] Assinantes: filtros completos antes da paginação e exclusão segura do histórico.
- [x] Testes locais, builds, regras de negócio e revisão React.

## Decisões

- TENANT permanece armazenado e enviado às adquirentes. Formatação e badge são visuais.
- Admin lista todos os produtos autorizados; cliente mantém escopo próprio.
- Cadastro de conta abre modal na aba Usuários. URL antiga abre esse mesmo modal.
- Status de assinantes: Todos, Ativas, Pausadas e Desativadas. Intervalos: Todos, Mensal e Anual (um mês/um ano).
- Exclusão permanece do histórico e exclusiva do admin master. Status desconhecido, ativo ou pausado não autoriza exclusão.
- Pausar, retomar e desativar continuam disponíveis segundo regras existentes.
- Nenhum cálculo financeiro, migração, push, deploy ou serviço externo será alterado.

## Validação prevista

Testes direcionados de descrição/payload, filtros/paginação e exclusão com adquirente simulada; navegador local para navegação, formulários, seleção e relatórios; builds dos dois repositórios. Commits usam usuário Git local e coautoria Codex, com hooks normais.

- Descrição: 2 testes locais aprovados (8 asserções); acesso ao detalhe administrativo preservado.

- Assinantes: filtros enviados diretamente ao BFF Nest (`GET /assinantes`); não há proxy intermediário Next para alterar. 9 testes Jest legados preservados e aprovados sob Node; novos testes usam Bun.

## Evidências da entrega

- Frontend: 3 testes unitários Bun aprovados (18 asserções) e 1 teste de navegador local aprovado (31 asserções). Cobrem descrição TENANT intacta, parâmetros de filtros, elegibilidade individual/em lote, catálogo completo, teclado, cadastro/erro/descarte/URL antiga, documento, aviso, navegação e ordem das taxas.
- Capturas com CSS compilado do projeto: `/tmp/simintpay-account-light.png` (desktop) e `/tmp/simintpay-account-dark.png` (mobile). Modal revisado em ambos os temas, com contraste explícito e sem cabeçalho duplicado.
- Frontend: build webpack concluído, incluindo TypeScript e 62 páginas estáticas, com fontes simuladas localmente (`NEXT_FONT_GOOGLE_MOCKED_RESPONSES`) e telemetria desativada. Permanece aviso de tracing de `/(marketing)/page_client-reference-manifest.js`; fontes da página inicial/marketing não foram alteradas nesta entrega. Servidor standalone local respondeu HTTP 200 em `/` e `/admin/contas`.
- Backend: 11 testes Bun aprovados (26 asserções), incluindo adaptador DOM que preserva status desconhecido/ausente e pausado. 9 testes Jest legados dos casos de uso também aprovados. Rebuild final (`bun run build`) aprovado.
- Revisão React: componentes novos separados e co-localizados, inputs novos com debounce/metadados, skeleton de assinantes antes de estados vazios/erro, catálogos compartilhados, modais com foco gerido pelo Dialog e rolagem temática.
- APIs/adquirente simuladas; nenhum serviço externo, banco ou migração acionado. Autoria e committer usam identidade Git local, com coautoria Codex.

Entrega concluída. Servidor local de verificação encerrado; nenhuma publicação ou alteração remota realizada.
