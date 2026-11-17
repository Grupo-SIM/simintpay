# Relatórios por plataforma e acesso dos donos

Plano aprovado: catálogo real pesquisável/paginado; saldos atribuídos administrativos;
relatórios financeiros e por produto para donos, sem custos/margens internos.
Plataformas inativas disponíveis para histórico. Dinheiro nas novas APIs em centavos.

- [x] Implementar contratos backend e escopo por dono.
- [x] Integrar catálogo, saldos e relatórios do dono.
- [x] Cobrir isolamento, estados assíncronos, pesquisa e paginação.
- [x] Validar localmente e criar commits em ambos os repositórios.

Somente trabalho local; sem migrações, consultas remotas, push ou publicação.

## Validação local

- Backend: 34 testes aprovados, incluindo 5 integrações SQL com PostgreSQL temporário local.
- Frontend: 2 testes de acesso e 2 fluxos de navegador com API simulada aprovados.
- Builds frontend e backend incluem validação TypeScript. Nenhuma consulta ao banco configurado ou provedor.

Backend correspondente: commit local `66a1c92`. Builds de ambos os projetos aprovados.

## Ajuste solicitado — relatório único e restauração de cards

- Financeiro e Produto reunidos em `UnifiedReports`, mesma entrada para admin e cliente. Seleção de plataforma abre detalhes sem trocar aba; saldos continuam administrativos.
- Painéis administrativos completos preservados, incluindo plataformas inativas. Tags com hífen/underscore resolvem a mesma apresentação e entrada do consolidado, corrigindo Zero Grau.
- Tabela global administrativa consulta transações do consolidado; consulta do dono permanece exclusiva de seu relatório, evitando misturar recortes.
- Skeleton até consultas necessárias concluírem; falhas de composição exibem erro e nova tentativa, sem cards financeiros zerados.
- Header, seletor e modal de Plataformas/Taxas agora usam controlador compartilhado; correção local `6370203`.
- Validação local: 40 asserções de relatórios no navegador, 13 de seleção compartilhada e 5 de aliases aprovadas. API simulada; sem chamadas a provedor ou produção. Build frontend final aprovado, incluindo TypeScript e geração das 62 páginas, com fontes simuladas locais. Backend sem alterações nesta correção.
