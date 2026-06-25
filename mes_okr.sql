-- ============================================================================
-- MES MALHA FORTE — OKRs (Objetivos e Resultados-Chave) — camada estratégica
-- Objetivo (qualitativo) → Resultados-Chave (mensuráveis). Cada KR pode puxar
-- o valor atual de uma métrica do sistema (oee, cnq, fpy, cpk, rnc_eficacia, cil)
-- ou ser manual. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS okr_objetivo (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo        TEXT NOT NULL,
    descricao     TEXT,
    periodo       TEXT,                         -- ex: '2026-T2'
    responsavel   TEXT,
    status        TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','concluido','arquivado')),
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS okr_resultado (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    objetivo_id   UUID NOT NULL REFERENCES okr_objetivo(id) ON DELETE CASCADE,
    descricao     TEXT NOT NULL,
    metrica       TEXT NOT NULL DEFAULT 'manual'  -- oee|cnq|fpy|cpk_ok|rnc_eficacia|cil|ncs|mtbf|mttr|manual
                  CHECK (metrica IN ('oee','cnq','fpy','cpk_ok','rnc_eficacia','cil','ncs','mtbf','mttr','manual')),
    unidade       TEXT,
    direcao       TEXT NOT NULL DEFAULT 'subir' CHECK (direcao IN ('subir','descer')),
    baseline      NUMERIC(14,3) NOT NULL DEFAULT 0,
    meta          NUMERIC(14,3) NOT NULL,
    valor_manual  NUMERIC(14,3),               -- usado quando metrica = 'manual'
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_atual_okr_obj ON okr_objetivo;
CREATE TRIGGER trg_atual_okr_obj BEFORE UPDATE ON okr_objetivo FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_okr_res ON okr_resultado;
CREATE TRIGGER trg_atual_okr_res BEFORE UPDATE ON okr_resultado FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE INDEX IF NOT EXISTS idx_okr_res_obj ON okr_resultado (objetivo_id);
ALTER TABLE okr_objetivo  DISABLE ROW LEVEL SECURITY;
ALTER TABLE okr_resultado DISABLE ROW LEVEL SECURITY;

-- força o PostgREST a recarregar o schema (senão a API responde "table not found")
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- FIM — okr_objetivo + okr_resultado. O valor atual de cada KR é calculado no
-- backend (/api/mf/okrs) a partir das métricas do sistema (/api/mf/metricas).
-- ============================================================================
