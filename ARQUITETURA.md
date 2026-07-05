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
- [x] **Onda 2 (FEITA)** — prioridade com dono único = **APS**. Antes `ordem_producao.prioridade` era gravada em 4 pontos (SIGS "Priorizar p/ chão" → `POST /api/mf/sequenciar-carteira`; MES fila `select`; MES prazo "▲ urgente"; APS). **Feito:** (1) ranqueador EDD em massa movido para `POST /api/aps/prioridade-edd` (dono APS, botão "⚡ Prioridade por EDD" na aba Sequenciamento); (2) `POST /api/mf/sequenciar-carteira` → 410 depreciado (ponteiro); (3) `PUT /api/mf/ops` deixou de aceitar `prioridade` (allowlist só `data_prevista`/`data_abertura`); (4) MES fila/prazo passaram a só EXIBIR a prioridade (badge read-only + dica "define no APS"); (5) SIGS "Priorizar" agora abre o APS. APS = único que escreve prioridade (`PUT /api/aps/ops/:id` manual + `prioridade-edd` em massa). Smoke: 410 ok, dry calcula 51 urg/78 alta de 259 sem gravar, PUT mf ignora prioridade, MES 0 selects, APS boota com botão.
- [x] **Onda 3 (FEITA)** — Heijunka no APS (aba Planejamento › Heijunka): ritmo por família (peças/período) + **caixa Heijunka com sequência mix-nivelada A-B-A-C** (maior-resto). Client-side sobre `this._ops`, família = marca→1ª palavra da descrição→código. Mais rico que o MES (que só nivelava volume). O `GET /api/mf/heijunka` + aba `heijunka` do MES ficam superados — **retirar do MES numa micro-onda com OK** (1 item de menu).
- [ ] **Onda 4** — tempo-padrão fonte MES: TOC do SIGS lê `tempo_padrao` (de-para com `banco`). *Risco médio — pode zerar o gargalo; validar números antes.*
- [ ] **Onda 5** — Preactor → APS: migrar `op_datas`/`setup_matrix`/`timeline_cenario` e o sequenciamento finito por tear para o APS; SIGS deixa de ter engine de sequenciamento. *Risco alto — Plano de Produção e a promessa leem essas tabelas.*
- [ ] **Onda 6** — entrada única da OP: um só canal de intake (APS dono da criação); ERP entra por ele; `op-unificado` mantém compatibilidade. *Risco alto — muitos dashboards leem a view.*

## Homônimos (não são conflito — só nome)
- **"Kanban"**: APS = reposição MTS (cria OP). MES = board de WIP (fluxo). Coisas diferentes.
