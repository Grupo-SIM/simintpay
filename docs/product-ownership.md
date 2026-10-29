# Titularidade dos produtos e contexto financeiro

Complementa `business-rules.md` para os cinco produtos existentes, sem unificá-los.

## Executor e titular

- `userId` do produto é seu titular financeiro. `createdByUserId` registra o executor das novas criações; histórico sem evidência permanece nulo.
- Admin deve escolher **um titular não administrativo ativo ou uma plataforma cadastrada**. Plataforma selecionada resolve seu dono; destinos incompatíveis são rejeitados. Não há destino implícito na conta administrativa.
- Usuário comum pode vender para si sem plataforma, mesmo possuindo várias. Permissão de operar uma plataforma não transfere seus recebíveis ao executor.
- Edições comuns preservam titular e contexto de plataforma. Transferências históricas e compensações exigem revisão e auditoria próprias; não há reatribuição automática por nome, documento, tag ou descrição.
- A conta empresarial SIM Intermediações é distinta do login administrativo e deve ser selecionada explicitamente quando for a vendedora.

## Identidade e taxas

- Identidade contratual usa `USER:<id>` estável; `CLIENT:<email>` é alias legado de conta cadastrada. Ambos são contextos reservados, não plataformas.
- Precedência de taxas: override da plataforma → override do titular → GLOBAL → padrão. Zero é override válido.
- A migração aditiva copia overrides legados preservando configurações já presentes na chave estável. Alterar e-mail não altera a identidade financeira após a migração.
- Comprador e vendedor têm documentos distintos. O CPF/CNPJ do vendedor vem do cadastro do titular; e-mail do comprador e descrição comercial não determinam quem recebe nem suas taxas.
- Não foi criado novo fluxo de verificação fiscal. Contas sem documento e contas técnicas históricas permanecem pendências para auditoria, sem documentos fabricados.

## Limites operacionais

A migração de autoria e taxas foi preparada e validada localmente, sem aplicação remota. Histórico de transações, snapshots e saldos não foi transferido. Delegação de criação não concede gestão geral dos produtos do dono; o acesso comum de listagem/edição continua limitado a titular/admin, além das APIs de plataforma existentes.

Plano em execução: [0009](../plans/0009-titularidade-ofertas-cobrancas.md). Unificação adiada: [0010](../plans/0010-unificacao-ofertas-cobrancas.md).
