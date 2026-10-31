# Paridade operacional do cliente — entrega futura

Documento de execução posterior. Nenhuma ampliação operacional autorizada nesta entrega.

## Matriz cliente/admin

| Área                                                        | Cliente nesta entrega                                  | Admin existente             | Futuro                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------ | --------------------------- | ------------------------------------------------------ |
| Planos, planos PIX, links de pagamento/assinatura e boletos | Criar/editar campos atuais e listar registros próprios | Gestão existente preservada | Avaliar opções adicionais individualmente              |
| Assinantes                                                  | Sem nova área                                          | Gestão administrativa       | Lista/detalhes e ações limitadas ao proprietário       |
| Relatórios                                                  | Sem nova área                                          | Consolidação administrativa | Métricas próprias sem taxas/receitas de terceiros      |
| Comunidades/plataformas                                     | Acesso bloqueado                                       | Gestão existente            | Definir necessidade e vínculos autorizados             |
| Taxas e proprietário                                        | Alteração bloqueada                                    | Gestão existente            | Continuar protegidos; contrato explícito se necessário |

## Próximas etapas

1. Inventariar diferenças de campos/ações entre cada formulário cliente/admin, definindo regra de acesso para cada opção.
2. Especificar assinantes próprios: cancelamento/pausa/retomada, consequências irreversíveis e auditoria.
3. Especificar relatórios próprios: filtros, exportações, valores líquidos e isolamento de dados.
4. Definir permissões backend por recurso/ação, aprovação da conta e propriedade; evitar confiar na navegação frontend.
5. Aprovar escopo separado antes de executar.

## Critérios de aceite futuros

- Todas as consultas/ações têm isolamento por usuário, testes com IDs adulterados e conta não aprovada.
- Nenhum dado de terceiro aparece em listagem, detalhe, exportação ou relatório agregado.
- Campos adicionais preservam identidade, links públicos e regras de valores mínimos.
- Paridade visual desktop/mobile e claro/escuro; skeletons antes de estados vazios/erros.
- Mudanças administrativas mantêm comportamento existente; nenhuma permissão é ampliada implicitamente.
