-- ═══════════════════════════════════════════════════════════════════════════
-- N1TECH · F2 — Planejamento: roteamento ABC-XYZ, previsão por família,
-- gate de capacidade (Drum) e S&OP leve. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── roteamento_staging — saída do job mensal, aguarda homologação (S&OP leve) ─
CREATE TABLE IF NOT EXISTS roteamento_staging (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ciclo              TEXT NOT NULL,               -- aaaa-mm
    codigo             TEXT NOT NULL,
    abc                TEXT CHECK (abc IN ('A','B','C')),
    xyz                TEXT CHECK (xyz IN ('X','Y','Z')),
    cv                 NUMERIC(14,4),
    volume_12m         NUMERIC(14,3),               -- ABC por VOLUME (valor zerado na base — dívida)
    pct_meses_zero     NUMERIC(5,1),
    item_novo          BOOLEAN NOT NULL DEFAULT false,   -- <6 meses de história → PUSH
    trilho_atual       TEXT,
    trilho_sugerido    TEXT NOT NULL CHECK (trilho_sugerido IN ('PULL','PUSH')),
    mudanca            BOOLEAN NOT NULL DEFAULT false,
    ciclos_consecutivos INTEGER NOT NULL DEFAULT 1,     -- histerese: só aplica com ≥2
    revisar_portfolio  BOOLEAN NOT NULL DEFAULT false,  -- CZ
    status             TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','HOMOLOGADO','REJEITADO')),
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ciclo, codigo)
);
ALTER TABLE roteamento_staging DISABLE ROW LEVEL SECURITY;

-- ── politica_item_hist — auditoria das mudanças de trilho ────────────────────
CREATE TABLE IF NOT EXISTS politica_item_hist (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo      TEXT NOT NULL,
    trilho_de   TEXT,
    trilho_para TEXT NOT NULL,
    ciclo       TEXT,
    motivo      TEXT,
    usuario     TEXT,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE politica_item_hist DISABLE ROW LEVEL SECURITY;

-- ── previsao_familia — EWMA α=0,1 + MAPE por família (segmento) ──────────────
CREATE TABLE IF NOT EXISTS previsao_familia (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    familia      TEXT NOT NULL,
    competencia  DATE NOT NULL,                 -- mês previsto (próximo)
    previsao     NUMERIC(14,3) NOT NULL,
    mape_pct     NUMERIC(6,1),                  -- erro médio 1-passo-à-frente na história
    meses_serie  INTEGER,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (familia, competencia)
);
ALTER TABLE previsao_familia DISABLE ROW LEVEL SECURITY;

-- ── carga_gargalo — escrita do gate (Drum ≤ 90%), leitura gate + S&OP ────────
CREATE TABLE IF NOT EXISTS carga_gargalo (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    avaliacao_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processo     TEXT NOT NULL,
    carga_min    NUMERIC(14,1) NOT NULL DEFAULT 0,   -- minutos de carga (OPs + sugeridas)
    cap_min      NUMERIC(14,1) NOT NULL DEFAULT 0,   -- capacidade do período × 0,90
    utilizacao   NUMERIC(6,1),                        -- %
    drum_ok      BOOLEAN,
    detalhe      JSONB DEFAULT '{}'
);
ALTER TABLE carga_gargalo DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_carga_aval ON carga_gargalo(avaliacao_em DESC);
