# Contribuindo (Repo Hygiene)

Este repositório prioriza **simplicidade** e **baixa poluição**. Antes de abrir PR, siga as regras abaixo.

## Definition of Done (DoD)

- Nenhum arquivo temporário/rascunho no PR (ex.: `*tmp*`, `*draft*`, `*.bak`, `*copy*`, `*_old*`).
- Nada de dumps de log (`*.log`) ou artefatos de build (`dist/`, `build/`, `*.tsbuildinfo`).
- Documentação nova só quando realmente necessária e **sempre** em `docs/` (com título claro e link no `README.md` se for referência frequente).
- Scripts utilitários devem ficar em `scripts/` e ter nome autoexplicativo.
- Mudanças pequenas e revisáveis (idealmente ≤ 10 arquivos por commit lógico).

## Pastas padrão

- `_scratch/`: para experimentos locais (ignorados pelo git).  
  Use livremente para rascunhos, anotações e outputs.
- `_quarantine/`: para itens suspeitos/legados **que não devem ir para o PR**.  
  Movemos para aqui quando precisamos tirar algo do caminho sem deletar.

## Se você encontrar “lixo” no repo

- Não delete direto.
- Prove orfandade (busca global + checar configs).
- Se for baixo risco, mova para `_quarantine/<data>-<slug>/...`.
- Se houver dúvida, abra nota/issue de “investigar”.

