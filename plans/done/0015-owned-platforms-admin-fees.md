# Plataformas próprias e taxas administrativas

Plano aprovado. Execução local em `simintpay-front` e `simintpay-back`.

- [x] Consulta própria por sessão e catálogo administrativo com caches separados.
- [x] Header/modal compartilhados, seleção global ou individual.
- [x] Administração sem repasse; custos da adquirente comparados antes de salvar.
- [x] Catálogo autenticado de adquirentes e migração preservando histórico.
- [x] Testes, builds, regras de negócio e commits locais.

Sem push, publicação ou alteração de banco externo.

## Validação

- Backend `df9f379`: 22 testes direcionados aprovados; isolamento por dono inclusive admin, catálogo autenticado, rejeição de adquirentes inexistentes, herança e conflito de versão.
- Migração aplicada em PostgreSQL temporário local: DOM/FRENDZ e códigos históricos registrados; revisões preservadas integralmente.
- Navegador com API local simulada: 55 asserções financeiras e 10 asserções de seleção/escopo aprovadas. Incluem parcelas independentes, custos, salvar/descartar e ausência de repasse no admin.
- Build backend aprovado. Build frontend inicial bloqueado por porta interna do Turbopack no sandbox; repetição local com permissão e fontes simuladas aprovada, incluindo TypeScript e geração das páginas.
- Alterações preexistentes de relatórios e SQL no backend preservadas fora desta entrega.

- Commits locais usam Aran Leite como autor e committer, com coautoria Codex. Hooks normais preservados; frontend não possui hooks ativos configurados.
