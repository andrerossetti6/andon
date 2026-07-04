# DECISOES.md — Módulo APS / PCP (Ordens de Produção + Carga)

Registro de decisões, premissas e dívidas técnicas, fase a fase.

## Fase 0 — Descoberta (2026-07-04)

**Decisões aprovadas pelo usuário:**
1. **Stack:** Node/Express/Supabase (a existente), NÃO Python/FastAPI — o prompt original pedia Python, mas "alinhar ao MES existente" prevalece. Testes via smoke de API + puppeteer (não pytest).
2. **Onde mora:** telas no **APS** (`aps.html`/`aps.js`), regras/endpoints no `server.js` (`/api/aps/*`), MES continua dono da execução (apontamento).
3. **Ordem:** fases 1→5 com checkpoint a cada fase.

**Gap analysis (o que JÁ existia e foi reaproveitado — não reconstruído):**
roteiro (`produto_etapa`), tempos (`tempo_padrao` produto×etapa c/ fallback), `setup_matrix` por família (SIGS), capacidade finita semanal + por tear (Preactor), TOC/gargalo, EDD/ATCS, heijunka/yamazumi (MES), ponto de reposição (Política de Estoques), avanço automático de OP por apontamento, CTP.

**Estados da OP:** mantidos os existentes (`planejada, liberada, em_producao, pausada, concluida, cancelada`) + **`bloqueada`** (novo). NÃO adotamos RASCUNHO/SEQUENCIADA/DESPACHADA/ENCERRADA do prompt — mapear 1:1 quebraria o MES em produção; a semântica é coberta (rascunho≈planejada, sequenciada/despachada ficam no Preactor, encerrada≈concluida).

## Fase 1 — Governança da OP (2026-07-04)

**Entregue:** máquina de estados validada (`APS_TRANS`), gate de liberação (`apsGate`), ledger append-only (`op_state_log`), estado BLOQUEADA com disposição obrigatória (`refazer|retrabalhar|refugar|substituir|investigar`), UI na Carteira do APS (+ Nova OP, Liberar c/ gate, Bloquear/Desbloquear, Cancelar, Histórico).

**Decisões:**
- **Gate checa:** roteiro existe + tempo-padrão > 0 em toda etapa do roteiro + data prevista + qtd > 0. **Material NÃO é checado** — não existe BOM (produto→fio) no sistema; checagem de material ficaria inventada. Dívida: quando houver BOM, adicionar ao gate.
- **Override do gate:** permitido com justificativa obrigatória, gravado no ledger com prefixo `OVERRIDE DO GATE:` + pendências ignoradas. Motivo: hoje `tempo_padrao=0` em quase tudo (bloqueio conhecido do piloto) — gate estrito travaria 100% das OPs.
- **Transições automáticas continuam** (apontamento → em_producao; fim do roteiro → concluida) e são **logadas** no ledger com `origem='apontamento'|'fluxo'`. Não exigimos `liberada` antes de `em_producao` na via automática — o chão de fábrica do piloto ainda opera OPs importadas do ERP direto; endurecer isso agora pararia o piloto. Dívida: quando o gate virar rotina, restringir.
- **Porta lateral fechada:** `POST /api/mf/ops` (upsert genérico) não altera mais o status de OP existente — status só muda pela transição (`/api/aps/ops/:id/transicao`) ou pelas vias automáticas logadas.
- **Enforcement real:** OP `bloqueada`/`cancelada` é REJEITADA no apontamento (409) — o hold não é decorativo.
- **Desbloqueio** volta ao estado anterior ao bloqueio (lido do ledger) ou vai a `cancelada`; sempre com disposição + justificativa.
- **Ledger é best-effort nas vias automáticas** (`.catch()`) — a produção não para se a tabela não existir; endpoints do APS respondem 503 com instrução (`aps_governanca.sql`).

**Dívidas técnicas registradas:**
- [ ] BOM/material no gate (não existe cadastro de composição).
- [ ] Restringir via automática planejada→em_producao quando o gate virar rotina.
- [ ] `pausada` não tem UI própria no APS (só via bloqueio); avaliar se o MES deveria pausar sessões automaticamente.
- [ ] Trigger SQL que proíba UPDATE/DELETE em `op_state_log` (hoje é convenção da aplicação; service_role bypassa).

## Fase 2 — Dados mestres de setup por atributo (pendente)
## Fase 3 — MTS/MTO + kanban eletrônico (pendente)
## Fase 4 — Pesos do sequenciador + granularidade dia/turno (pendente)
## Fase 5 — Loop fechado (DESATUALIZADO + comparadores) (pendente)
