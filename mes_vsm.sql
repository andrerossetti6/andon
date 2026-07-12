-- ═══════════════════════════════════════════════════════════════════════════
-- MES · VSM (Mapa de Fluxo de Valor) — módulo de DIAGNÓSTICO (foto, não filme)
-- Deriva o VSM dos dados que o MES já captura (apontamento + parada +
-- op_state_log + WIP). Só LEITURA de estoque/pulmão — não duplica nem escreve.
-- Roda sob demanda / no fechamento mensal do S&OP, por FAMÍLIA. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- família = conjunto de SKUs que compartilham o mesmo fluxo (VSM é por família,
-- nunca SKU a SKU). skus por lista OU por atributo (marca/segmento).
CREATE TABLE IF NOT EXISTS vsm_familia (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome             TEXT NOT NULL,
    filtro_tipo      TEXT NOT NULL DEFAULT 'marca' CHECK (filtro_tipo IN ('marca','segmento','skus')),
    filtro_valor     TEXT,                          -- marca/segmento (quando filtro_tipo != 'skus')
    skus             TEXT[] NOT NULL DEFAULT '{}',   -- lista explícita (quando filtro_tipo = 'skus')
    sequencia_etapas TEXT[] NOT NULL DEFAULT '{}',   -- override da ordem; vazio = ordem observada nos apontamentos
    ativo            BOOLEAN NOT NULL DEFAULT true,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE vsm_familia DISABLE ROW LEVEL SECURITY;

-- um mapa calculado = uma linha por família por período. %VA é GENERATED.
CREATE TABLE IF NOT EXISTS vsm_snapshot (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    familia_id       UUID NOT NULL REFERENCES vsm_familia(id) ON DELETE CASCADE,
    tipo             TEXT NOT NULL DEFAULT 'ATUAL' CHECK (tipo IN ('ATUAL','FUTURO')),
    periodo_inicio   DATE NOT NULL,
    periodo_fim      DATE NOT NULL,
    lead_time_min    NUMERIC(12,1) NOT NULL DEFAULT 0,
    va_total_min     NUMERIC(12,1) NOT NULL DEFAULT 0,
    pct_va           NUMERIC(6,3) GENERATED ALWAYS AS
                        (CASE WHEN lead_time_min > 0 THEN va_total_min / lead_time_min * 100 ELSE 0 END) STORED,
    n_ordens_amostra INTEGER NOT NULL DEFAULT 0,
    baixa_confianca  BOOLEAN NOT NULL DEFAULT false, -- n_ordens < 5
    nota             TEXT,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE vsm_snapshot DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_vsm_snap_fam ON vsm_snapshot(familia_id, criado_em DESC);

-- detalhe por etapa (alimenta o desenho: caixa de dados + triângulo de espera)
CREATE TABLE IF NOT EXISTS vsm_snapshot_etapa (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id      UUID NOT NULL REFERENCES vsm_snapshot(id) ON DELETE CASCADE,
    ordem_seq        INTEGER NOT NULL,
    etapa            TEXT NOT NULL,
    tempo_va_min     NUMERIC(12,1) NOT NULL DEFAULT 0,   -- mediana (não média)
    tempo_proc_min   NUMERIC(12,1) NOT NULL DEFAULT 0,   -- fim−início (inclui parada)
    tempo_espera_min NUMERIC(12,1) NOT NULL DEFAULT 0,   -- espera ANTES desta etapa (mediana)
    wip_atual        INTEGER,                            -- OPs paradas nesta etapa AGORA (mf/wip)
    refugo_pct       NUMERIC(6,2),                       -- % refugo medido nesta etapa
    UNIQUE (snapshot_id, ordem_seq)
);
ALTER TABLE vsm_snapshot_etapa DISABLE ROW LEVEL SECURITY;
