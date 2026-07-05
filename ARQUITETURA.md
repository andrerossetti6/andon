# ARQUITETURA — 3 sistemas, fronteira ISA-95

Um banco (Supabase), um servidor (Express), um tema (`style.css`). **Regra de ouro:** cada
capacidade mora em UM sistema (o dono natural pela camada ISA-95/MESA-11). Sem repetição.

## Camadas (dono por sistema)

| Sistema | Camada | Escopo (dono de…) | Handoff |
|---|---|---|---|
| **SIGS** | N4 Planejamento | Demanda, Previsão, **Política de Estoques + ponto de reposição**, Plano agregado, S&OP, financeiro (R$), **RCCP/TOC (capacidade nominal, `capacidade_config`)** | → APS: plano congelado + política/ponto + capacidade nominal |
| **APS** | N3 Programação | **Ciclo de vida da OP** (gate, estados, ledger), **prioridade**, **sequenciamento finito** (datas/tear), **matriz de setup**, **kanban de reposição**, **Heijunka** | → MES: OP liberada + sequenciada + tear alvo + data |
| **MES** | N3 Execução/Qualidade/Manutenção | Apontamento (captura única), **etapa_atual/WIP real**, OEE **medido**, NC/CEP/CNQ/SGQ, TPM, rastreabilidade, **tempo-padrão (cronoanálise)**, Lean de chão (VSM/yamazumi/5S/A3) | → SIGS/APS: produção real, WIP/leadtime, tempo-padrão aferido, confirmações ERP |

## Decisões do dono (2026-07-05)
1. **Tempo-padrão:** fonte única = **MES** (cronoanálise medida). A base Stoll (`banco`) vira só *seed/import*. → o TOC do SIGS passa a consumir o tempo-padrão do MES (migração cuidadosa — de-para antes de desligar `banco`).
2. **Heijunka (nivelamento):** move para o **APS** (é técnica de programação N3).
3. **Política/ponto de reposição:** número nasce no **SIGS** (Política de Estoques); APS **consome** e só grava atributos do cartão (`produto.politica`, `lote_reposicao`). *(Já é assim — confirmado.)*

## Ondas de consolidação (menor risco → maior)
- [x] **Onda 1** — aposentar SIGS "Matriz de Set Up" (importador órfão de `dados_capacidade`, nada lê); registrar esta arquitetura. *Zero risco.*
- [ ] **Onda 2 (REGISTRADA — pendente de execução)** — prioridade com dono único. **Problema:** `ordem_producao.prioridade` é gravada em 2 lugares — MES (`POST /api/mf/sequenciar-carteira` ~server.js:1496, e a tela `prazo`) e APS (`PUT /api/aps/ops/:id`). Last-writer-wins silencioso. **Ação:** cortar a escrita do MES (a tela `prazo`/`fila` passa a só EXIBIR risco; o `sequenciar-carteira` deixa de gravar); APS continua o único que grava. **Risco baixo**, mas muda o botão "sequenciar carteira" do MES (hoje o operador o usa) → precisa OK do dono. Adiada a pedido do dono.
- [x] **Onda 3 (FEITA)** — Heijunka no APS (aba Planejamento › Heijunka): ritmo por família (peças/período) + **caixa Heijunka com sequência mix-nivelada A-B-A-C** (maior-resto). Client-side sobre `this._ops`, família = marca→1ª palavra da descrição→código. Mais rico que o MES (que só nivelava volume). O `GET /api/mf/heijunka` + aba `heijunka` do MES ficam superados — **retirar do MES numa micro-onda com OK** (1 item de menu).
- [ ] **Onda 4** — tempo-padrão fonte MES: TOC do SIGS lê `tempo_padrao` (de-para com `banco`). *Risco médio — pode zerar o gargalo; validar números antes.*
- [ ] **Onda 5** — Preactor → APS: migrar `op_datas`/`setup_matrix`/`timeline_cenario` e o sequenciamento finito por tear para o APS; SIGS deixa de ter engine de sequenciamento. *Risco alto — Plano de Produção e a promessa leem essas tabelas.*
- [ ] **Onda 6** — entrada única da OP: um só canal de intake (APS dono da criação); ERP entra por ele; `op-unificado` mantém compatibilidade. *Risco alto — muitos dashboards leem a view.*

## Homônimos (não são conflito — só nome)
- **"Kanban"**: APS = reposição MTS (cria OP). MES = board de WIP (fluxo). Coisas diferentes.
