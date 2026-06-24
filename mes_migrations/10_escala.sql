-- ============================================================================
-- MES MALHA FORTE — Onda 6b: rastreabilidade MULTI-ETAPA + view materializada
-- (1) lote_producao + consumo_lote → encadeia lotes entre etapas (cru→tingido→
--     acabado), com genealogia recursiva (do fio à peça final).
-- (2) mv_oee materializada para escala. Idempotente.
-- ============================================================================

-- 1. lote_producao — o que uma sessão de apontamento PRODUZIU (um lote rastreável)
CREATE TABLE IF NOT EXISTS lote_producao (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          TEXT NOT NULL UNIQUE,
    apontamento_id  UUID REFERENCES apontamento(id),     -- sessão que o produziu
    produto_id      UUID REFERENCES produto(id),
    etapa           TEXT NOT NULL CHECK (etapa IN ('malharia','tinturaria','acabamento','revisao')),
    qtd_kg          NUMERIC(14,3) NOT NULL DEFAULT 0,
    qtd_disponivel_kg NUMERIC(14,3) NOT NULL DEFAULT 0,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_atual_lote_prod ON lote_producao;
CREATE TRIGGER trg_atual_lote_prod BEFORE UPDATE ON lote_producao FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- 2. consumo_lote — uma sessão consome um lote de produção de etapa anterior
CREATE TABLE IF NOT EXISTS consumo_lote (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apontamento_id   UUID NOT NULL REFERENCES apontamento(id),   -- quem consome
    lote_producao_id UUID NOT NULL REFERENCES lote_producao(id), -- o lote consumido
    qtd_consumida_kg NUMERIC(14,3) NOT NULL CHECK (qtd_consumida_kg > 0),
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lote_prod_apont ON lote_producao (apontamento_id);
CREATE INDEX IF NOT EXISTS idx_consumo_lote_ap ON consumo_lote (apontamento_id);
CREATE INDEX IF NOT EXISTS idx_consumo_lote_lt ON consumo_lote (lote_producao_id);
ALTER TABLE lote_producao DISABLE ROW LEVEL SECURITY;
ALTER TABLE consumo_lote  DISABLE ROW LEVEL SECURITY;

-- Genealogia recursiva: dado um lote de produção, sobe toda a cadeia de etapas
-- (lote final → lotes consumidos → ... → fio), via consumo_lote + a sessão.
CREATE OR REPLACE VIEW vw_genealogia_etapas AS
WITH RECURSIVE cadeia AS (
    -- raiz: cada lote de produção
    SELECT lp.id AS lote_raiz, lp.id AS lote_id, lp.codigo, lp.etapa, lp.apontamento_id, 0 AS nivel
    FROM lote_producao lp
    UNION ALL
    -- desce: lotes consumidos pela sessão que produziu o lote corrente
    SELECT c.lote_raiz, lpf.id, lpf.codigo, lpf.etapa, lpf.apontamento_id, c.nivel + 1
    FROM cadeia c
    JOIN consumo_lote   cl  ON cl.apontamento_id = c.apontamento_id
    JOIN lote_producao  lpf ON lpf.id = cl.lote_producao_id
    WHERE c.nivel < 10
)
SELECT lote_raiz, lote_id, codigo, etapa, nivel FROM cadeia;

-- ── View materializada de OEE (escala) ────────────────────────────────────────
-- Mesma lógica da vw_oee, materializada. Em produção com milhões de apontamentos,
-- o painel pode ler mv_oee (rápido) e agendar REFRESH (endpoint /api/mf/refresh).
DROP MATERIALIZED VIEW IF EXISTS mv_oee;
CREATE MATERIALIZED VIEW mv_oee AS SELECT * FROM vw_oee;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_oee_maq ON mv_oee (maquina_id);

-- ============================================================================
-- FIM — multi-etapa (lote_producao + consumo_lote + genealogia recursiva) e
-- mv_oee (escala). REFRESH MATERIALIZED VIEW CONCURRENTLY mv_oee; via endpoint.
-- ============================================================================
