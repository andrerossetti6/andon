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
- [ ] **Onda 2** — prioridade com dono único: APS grava; MES `sequenciar-carteira`/`prazo` param de gravar `prioridade` (só exibem risco). *Risco baixo — só cortar a escrita do MES.*
- [ ] **Onda 3** — Heijunka no APS (aba nova, read-only leveling); MES vira ponteiro. *Risco baixo (aditivo).*
- [ ] **Onda 4** — tempo-padrão fonte MES: TOC do SIGS lê `tempo_padrao` (de-para com `banco`). *Risco médio — pode zerar o gargalo; validar números antes.*
- [ ] **Onda 5** — Preactor → APS: migrar `op_datas`/`setup_matrix`/`timeline_cenario` e o sequenciamento finito por tear para o APS; SIGS deixa de ter engine de sequenciamento. *Risco alto — Plano de Produção e a promessa leem essas tabelas.*
- [ ] **Onda 6** — entrada única da OP: um só canal de intake (APS dono da criação); ERP entra por ele; `op-unificado` mantém compatibilidade. *Risco alto — muitos dashboards leem a view.*

## Homônimos (não são conflito — só nome)
- **"Kanban"**: APS = reposição MTS (cria OP). MES = board de WIP (fluxo). Coisas diferentes.
