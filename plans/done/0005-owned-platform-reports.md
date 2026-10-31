# Relatórios por plataforma e acesso dos donos

Plano aprovado: catálogo real pesquisável/paginado; saldos atribuídos administrativos;
relatórios financeiros e por produto para donos, sem custos/margens internos.
Inativas disponíveis somente para leitura histórica; carteira permanece do usuário.

- [x] Implementar catálogo, escopo autorizado, relatórios e saldos locais.
- [x] Integrar frontend, seletor pesquisável e acesso dos donos.
- [x] Cobrir isolamento, paginação, histórico e carteira compartilhada.
- [x] Validar localmente e criar commits por repositório.

Nenhuma migração, chamada de provedor, push ou publicação.

## Validação

- `bun run build`: aprovado (inclui TypeScript).
- 34 testes aprovados em 7 arquivos, incluindo 5 integrações SQL com dados fictícios.
- PostgreSQL temporário local em `127.0.0.1:55479`; nunca usa `DATABASE_URL`.
- Suíte SQL opt-in: `REPORTS_LOCAL_SQL_TEST=1 bun test src/application/services/tests/owned-platform-reports.sql.test.ts`.
- Frontend: acesso por dono, catálogo pesquisável, saldos e estados de erro validados em navegador com API simulada.

Para repetir SQL: criar cluster com `initdb -D /tmp/simintpay-reports-pg -A trust -U reports --no-locale --encoding=UTF8`,
iniciar com `pg_ctl -D /tmp/simintpay-reports-pg -l /tmp/simintpay-reports-pg.log -o '-h 127.0.0.1 -p 55479 -k /tmp' start`,
e encerrar com `pg_ctl -D /tmp/simintpay-reports-pg stop`. Reutilizar cluster se já criado.
