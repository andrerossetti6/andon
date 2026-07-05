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

## Fase 2 — Dados mestres de setup por atributo (2026-07-04)

**Entregue:** atributos de setup no produto (`galga`, `cor_base`, `programa_maquina` — `titulo_fio` já existia), restrições físicas na máquina (`galga_min`/`galga_max`), tabela `setup_troca_atributo` (minutos por troca de fio/galga/cor/programa), endpoints (`GET/POST /api/aps/setup-troca`, `POST /api/aps/atributos/bulk` com allowlist por tabela, UPDATE-only por código), aba **Produtos & Setup** no APS (tempos de troca + tabela editável inline + import por colagem de planilha TAB/;) e galga mín/máx editável na aba Máquinas.

**Decisões:**
- **Modelo v1 por ATRIBUTO, não por par de valores:** custo de transição = soma dos minutos dos atributos que mudam entre OPs consecutivas. O prompt pedia matriz `attr_from→attr_to`; pares explodem combinatorialmente e ninguém preenche. Limitação documentada: se um par específico tiver tempo muito diferente (ex.: galga 5→12 ≠ 12→14), evoluir para pares com fallback no atributo. A `setup_matrix` por FAMÍLIA (SIGS/Preactor) continua valendo onde já é usada.
- **Minutos começam em 0** — tempos reais são da fábrica, nada inventado. Sequenciador (Fase 4) ignora atributo com 0 min.
- **Import não cria produto** — só atualiza códigos existentes (UPDATE-only) e reporta os não encontrados; criação de produto continua no MES/ERP.
- **Atributos NÃO entram no gate de liberação** — são qualidade de sequenciamento, não viabilidade da OP. Entram como custo na Fase 4.

**Dívidas:**
- [ ] Compatibilidade produto×máquina (galga do produto dentro de galga_min/max do tear) aplicada na alocação — Fase 4.
- [ ] Evoluir para matriz por par de valores se os tempos reais exigirem.
## Fase 3 — MTS/MTO + kanban eletrônico (2026-07-05)

**Entregue:** política de produção por SKU (`produto.politica` MTS|MTO|ATO, NULL = não definida), lote de reposição (`produto.lote_reposicao`), origem `kanban` nas OPs, endpoint `POST /api/aps/kanban/verificar` (dry-run padrão; `dry:false` gera), aba **Kanban (Reposição)** no APS + colunas POLÍTICA/LOTE em Produtos & Setup.

**Decisões:**
- **Fontes de dados reais, nada inventado:** estoque = última importação de estoque do SIGS; ponto de reposição = `estoque_minimo` (SIGS › Política de Estoques). Produto sem ponto/lote/estoque aparece na prévia com a situação explícita (SEM PONTO / SEM LOTE / SEM ESTOQUE INFO) — não gera OP às cegas.
- **Kanban clássico: 1 cartão ativo por produto** — enquanto existir OP `origem='kanban'` não concluída/cancelada, não gera outra. Qtd do cartão = lote_reposicao fixo (não `ponto−estoque`): reposição por lote é o modelo de supermercado; se o buraco for maior que um lote, o próximo cartão sai quando o primeiro concluir.
- **Sob demanda, não job automático:** o PCP clica Verificar (prévia) e decide gerar — sem OPs nascendo silenciosamente de madrugada. Automatizar depois é trivial (cron chamando o mesmo endpoint).
- **OP kanban nasce PLANEJADA e passa pelo gate** como qualquer OP (sem prazo — o PCP define ao liberar). Criação registrada no ledger com estoque/ponto/lote do momento.
- Numeração `KB-<código>-<aammdd>` com sufixo em colisão.

**Dívidas:**
- [ ] Estoque considera só produto acabado importado no SIGS — sem WIP/reservas (carteira MTO não abate).
- [ ] Automatizar verificação (cron) quando o fluxo estiver rodado manualmente por algumas semanas.
## Fase 4 — Pesos do sequenciador + granularidade dia/turno (pendente)
## Fase 5 — Loop fechado (DESATUALIZADO + comparadores) (pendente)
