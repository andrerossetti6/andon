-- ============================================================================
-- MES MALHA FORTE — WIP unificado: "a apontamento é a célula do WIP"
-- Aposenta fluxo_movimento. A posição da OP vira um ponteiro em ordem_producao
-- (etapa_atual_id) e WIP/lead/throughput passam a derivar do APONTAMENTO.
-- Captura única: o apontamento é a raiz; WIP é VIEW/ponteiro. Idempotente.
-- ============================================================================

-- a sessão de apontamento sabe a etapa do fluxo (base do lead time/throughput)
ALTER TABLE apontamento ADD COLUMN IF NOT EXISTS etapa_id UUID REFERENCES etapa_processo(id);

-- ponteiro de posição da OP no fluxo + desde quando está nesta etapa
ALTER TABLE ordem_producao ADD COLUMN IF NOT EXISTS etapa_atual_id UUID REFERENCES etapa_processo(id);
ALTER TABLE ordem_producao ADD COLUMN IF NOT EXISTS etapa_desde     TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_op_etapa_atual ON ordem_producao (etapa_atual_id);

-- derruba as views antigas (sobre fluxo_movimento) e a tabela aposentada
DROP VIEW  IF EXISTS vw_wip_etapa      CASCADE;
DROP VIEW  IF EXISTS vw_wip_leadtime   CASCADE;
DROP VIEW  IF EXISTS vw_wip_throughput CASCADE;
DROP TABLE IF EXISTS fluxo_movimento   CASCADE;

-- lead time (tempo de processamento) por etapa = duração média das sessões fechadas
CREATE VIEW vw_wip_leadtime AS
SELECT etapa_id,
       COUNT(*)                                                                       AS concluidos,
       ROUND(AVG(EXTRACT(EPOCH FROM (datahora_fim - datahora_inicio)) / 3600.0)::numeric, 2) AS horas_medias
FROM apontamento
WHERE etapa_id IS NOT NULL AND datahora_fim IS NOT NULL
GROUP BY etapa_id;

-- throughput por etapa = sessões fechadas (e qtd boa) nos últimos 7 dias
CREATE VIEW vw_wip_throughput AS
SELECT etapa_id,
       COUNT(*)                                          AS saidas_7d,
       COALESCE(SUM(qtd_boa), 0)                         AS qtd_7d,
       ROUND((COUNT(*) / 7.0)::numeric, 3)              AS ops_dia,
       ROUND((COALESCE(SUM(qtd_boa), 0) / 7.0)::numeric, 3) AS qtd_dia
FROM apontamento
WHERE etapa_id IS NOT NULL AND datahora_fim IS NOT NULL AND datahora_fim >= now() - interval '7 days'
GROUP BY etapa_id;

NOTIFY pgrst, 'reload schema';

-- PROVA: 2 (colunas criadas) e fluxo_movimento deve sumir (NULL)
SELECT (SELECT count(*) FROM information_schema.columns
        WHERE table_name = 'ordem_producao' AND column_name IN ('etapa_atual_id', 'etapa_desde')) AS colunas_ok,
       to_regclass('public.fluxo_movimento') AS fluxo_movimento_deve_ser_null;
