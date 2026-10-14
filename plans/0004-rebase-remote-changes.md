# Rebase e integração das mudanças remotas

Execução local aprovada. Sem fetch, push, banco externo ou deploy.

## Referências

- Backup: `backup/pre-remote-rebase-20261014`, HEAD `2cf37f2e04bf38d1007e6cb9ed885a6d3a0233c8`.
- Remoto analisado: `origin/main`, `2ceaa057abc233f333752fe9fa567674a331e418`.
- Base comum: `470f09a05878271c8ab19d1e42e3174e6add0079`; 36 commits locais.

## Etapas

- [x] Ler plano 0003, verificar árvore limpa e criar backup local.
- [ ] Reaplicar commits e resolver conflitos preservando núcleo compartilhado.
- [ ] Integrar classificação, filtros e afiliados.
- [ ] Integrar taxas, marcador FINAL_NET e liquidação atômica sem alterar histórico.
- [ ] Adaptar consultas externas à configuração explícita criptografada, isolamento e limites.
- [ ] Testar com mocks, verificar migrations localmente, build e range-diff; concluir com árvore limpa.

## Regras confirmadas

Links novos sem descontos adicionais de cashback/fixa; juros do comprador permanecem receita da plataforma. Defaults: 9% e saque R$ 3,50; override zero válido. Histórico, dono e isolamento preservados. Consulta externa somente leitura, sem inferência de dono por e-mail; estados unconfigured/unavailable explícitos.
