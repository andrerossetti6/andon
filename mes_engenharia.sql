-- ============================================================================
-- MES MALHA FORTE — ENGENHARIA DE PROCESSOS E MÉTODOS
-- Fecha o ciclo do engenheiro industrial sobre a captura única (apontamento):
--  1) Cronoanálise (tempo real × padrão), 3) Produtividade por operador,
--  4) Custeio real por OP, 5) FMEA + Kaizen + 5-porquês estruturado.
-- (2 Balanceamento/takt é calculado no backend, não precisa de view.)
-- Tudo VIEW/derivado sobre as tabelas existentes — nada inventado. Idempotente.
-- ============================================================================

-- ── tempo líquido por apontamento finalizado (descontando paradas) ──────────
-- (CTE repetida em cada view porque view não compartilha CTE entre si)

-- 1) CRONOANÁLISE ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_cronoanalise AS
SELECT a.id AS apontamento_id, a.etapa_id, e.nome AS etapa, e.ordem AS etapa_ordem,
       op.produto_id, pr.codigo AS produto, pr.descricao AS produto_desc,
       (a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho) AS qtd_total,
       GREATEST(EXTRACT(EPOCH FROM (a.datahora_fim - a.datahora_inicio)) - COALESCE(par.seg, 0), 0) AS seg_liquido,
       CASE WHEN (a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho) > 0
            THEN ROUND((GREATEST(EXTRACT(EPOCH FROM (a.datahora_fim - a.datahora_inicio)) - COALESCE(par.seg, 0), 0)
                 / (a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho))::numeric, 3) END AS seg_real_unidade,
       COALESCE(tpp.seg_por_unidade, tpe.seg_por_unidade) AS seg_padrao,
       a.datahora_fim
  FROM apontamento a
  JOIN etapa_processo e ON e.id = a.etapa_id
  JOIN ordem_producao op ON op.id = a.op_id
  LEFT JOIN produto pr ON pr.id = op.produto_id
  LEFT JOIN (SELECT apontamento_id, SUM(duracao_segundos) seg FROM parada WHERE datahora_fim IS NOT NULL GROUP BY apontamento_id) par ON par.apontamento_id = a.id
  LEFT JOIN tempo_padrao tpp ON tpp.etapa_id = a.etapa_id AND tpp.produto_id = op.produto_id
  LEFT JOIN tempo_padrao tpe ON tpe.etapa_id = a.etapa_id AND tpe.produto_id IS NULL
 WHERE a.datahora_fim IS NOT NULL AND a.etapa_id IS NOT NULL;

-- resumo por produto+etapa: média medida, nº de observações, padrão atual, desvio
CREATE OR REPLACE VIEW vw_cronoanalise_resumo AS
SELECT etapa_id, etapa, etapa_ordem, produto_id, produto, produto_desc,
       COUNT(*) AS observacoes,
       ROUND(AVG(seg_real_unidade)::numeric, 3) AS seg_real_medio,
       ROUND(MIN(seg_real_unidade)::numeric, 3) AS seg_real_min,
       ROUND(MAX(seg_real_unidade)::numeric, 3) AS seg_real_max,
       MAX(seg_padrao) AS seg_padrao,
       CASE WHEN MAX(seg_padrao) > 0
            THEN ROUND(((AVG(seg_real_unidade) - MAX(seg_padrao)) / MAX(seg_padrao) * 100)::numeric, 1) END AS desvio_pct
  FROM vw_cronoanalise
 WHERE seg_real_unidade IS NOT NULL
 GROUP BY etapa_id, etapa, etapa_ordem, produto_id, produto, produto_desc;

-- 3) PRODUTIVIDADE POR OPERADOR ──────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_produtividade_operador AS
SELECT o.id AS operador_id, o.nome AS operador,
       COUNT(*) AS sessoes,
       SUM(a.qtd_boa) AS qtd_boa, SUM(a.qtd_refugo) AS qtd_refugo, SUM(a.qtd_retrabalho) AS qtd_retrab,
       ROUND((SUM(GREATEST(EXTRACT(EPOCH FROM (a.datahora_fim - a.datahora_inicio)) - COALESCE(par.seg, 0), 0)) / 3600.0)::numeric, 2) AS horas,
       CASE WHEN SUM(GREATEST(EXTRACT(EPOCH FROM (a.datahora_fim - a.datahora_inicio)) - COALESCE(par.seg, 0), 0)) > 0
            THEN ROUND((SUM(a.qtd_boa) / (SUM(GREATEST(EXTRACT(EPOCH FROM (a.datahora_fim - a.datahora_inicio)) - COALESCE(par.seg, 0), 0)) / 3600.0))::numeric, 2) END AS pecas_por_hora,
       CASE WHEN SUM(a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho) > 0
            THEN ROUND((SUM(a.qtd_refugo) / SUM(a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho) * 100)::numeric, 1) END AS refugo_pct,
       CASE WHEN SUM(a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho) > 0
            THEN ROUND((SUM(a.qtd_retrabalho) / SUM(a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho) * 100)::numeric, 1) END AS retrab_pct
  FROM apontamento a
  JOIN operador o ON o.id = a.operador_id
  LEFT JOIN (SELECT apontamento_id, SUM(duracao_segundos) seg FROM parada WHERE datahora_fim IS NOT NULL GROUP BY apontamento_id) par ON par.apontamento_id = a.id
 WHERE a.datahora_fim IS NOT NULL
 GROUP BY o.id, o.nome;

-- 4) CUSTEIO REAL POR OP ─────────────────────────────────────────────────────
-- taxas (R$/h) são CADASTRO do usuário — nunca inventadas; ficam nulas até preencher
ALTER TABLE operador ADD COLUMN IF NOT EXISTS custo_hora NUMERIC(12,4);
ALTER TABLE maquina  ADD COLUMN IF NOT EXISTS custo_hora NUMERIC(12,4);

CREATE OR REPLACE VIEW vw_custo_op AS
WITH ap AS (
  SELECT a.op_id, a.operador_id, a.maquina_id, a.qtd_boa, a.qtd_refugo,
         GREATEST(EXTRACT(EPOCH FROM (a.datahora_fim - a.datahora_inicio)) - COALESCE(par.seg, 0), 0) / 3600.0 AS horas
    FROM apontamento a
    LEFT JOIN (SELECT apontamento_id, SUM(duracao_segundos) seg FROM parada WHERE datahora_fim IS NOT NULL GROUP BY apontamento_id) par ON par.apontamento_id = a.id
   WHERE a.datahora_fim IS NOT NULL
)
SELECT op.id AS op_id, op.numero, pr.codigo AS produto,
       ROUND(SUM(ap.horas)::numeric, 2) AS horas,
       ROUND(SUM(ap.horas * COALESCE(o.custo_hora, 0))::numeric, 2) AS custo_mo,
       ROUND(SUM(ap.horas * COALESCE(m.custo_hora, 0))::numeric, 2) AS custo_maquina,
       ROUND(SUM(ap.qtd_boa * COALESCE(pr.custo_unitario, 0))::numeric, 2) AS custo_material,
       ROUND(SUM(ap.qtd_refugo * COALESCE(pr.custo_unitario, 0))::numeric, 2) AS custo_refugo,
       ROUND((SUM(ap.horas * COALESCE(o.custo_hora, 0)) + SUM(ap.horas * COALESCE(m.custo_hora, 0))
            + SUM(ap.qtd_boa * COALESCE(pr.custo_unitario, 0)) + SUM(ap.qtd_refugo * COALESCE(pr.custo_unitario, 0)))::numeric, 2) AS custo_total,
       SUM(ap.qtd_boa) AS qtd_boa
  FROM ap
  JOIN ordem_producao op ON op.id = ap.op_id
  LEFT JOIN produto pr ON pr.id = op.produto_id
  LEFT JOIN operador o ON o.id = ap.operador_id
  LEFT JOIN maquina m ON m.id = ap.maquina_id
 GROUP BY op.id, op.numero, pr.codigo;

-- 5a) FMEA de processo (RPN = severidade × ocorrência × detecção) ─────────────
CREATE TABLE IF NOT EXISTS fmea (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    etapa_id    UUID REFERENCES etapa_processo(id) ON DELETE CASCADE,
    modo_falha  TEXT NOT NULL,
    efeito      TEXT,
    causa       TEXT,
    severidade  INT CHECK (severidade BETWEEN 1 AND 10),
    ocorrencia  INT CHECK (ocorrencia BETWEEN 1 AND 10),
    deteccao    INT CHECK (deteccao  BETWEEN 1 AND 10),
    rpn         INT GENERATED ALWAYS AS (severidade * ocorrencia * deteccao) STORED,
    acao        TEXT,
    ativo       BOOLEAN NOT NULL DEFAULT true,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE fmea DISABLE ROW LEVEL SECURITY;

-- 5b) Kaizen (funil de melhoria contínua: ideia → teste → padrão) ────────────
CREATE TABLE IF NOT EXISTS kaizen (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo        TEXT NOT NULL,
    descricao     TEXT,
    etapa_id      UUID REFERENCES etapa_processo(id) ON DELETE SET NULL,
    status        TEXT NOT NULL DEFAULT 'ideia' CHECK (status IN ('ideia','teste','padrao','descartado')),
    ganho_esperado TEXT,
    responsavel   TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE kaizen DISABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_atual_kaizen ON kaizen;
CREATE TRIGGER trg_atual_kaizen BEFORE UPDATE ON kaizen FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- 5c) 5-porquês estruturado na RNC (já tem causa_raiz/metodo_analise) ─────────
ALTER TABLE rnc ADD COLUMN IF NOT EXISTS porque_1 TEXT;
ALTER TABLE rnc ADD COLUMN IF NOT EXISTS porque_2 TEXT;
ALTER TABLE rnc ADD COLUMN IF NOT EXISTS porque_3 TEXT;
ALTER TABLE rnc ADD COLUMN IF NOT EXISTS porque_4 TEXT;
ALTER TABLE rnc ADD COLUMN IF NOT EXISTS porque_5 TEXT;

NOTIFY pgrst, 'reload schema';

SELECT 'engenharia OK' AS status,
       (SELECT count(*) FROM information_schema.views  WHERE table_name LIKE 'vw_crono%' OR table_name IN ('vw_produtividade_operador','vw_custo_op')) AS views,
       (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('fmea','kaizen')) AS tabelas;
