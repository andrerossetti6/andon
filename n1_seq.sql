-- ═══════════════════════════════════════════════════════════════════════════
-- N1TECH · SEQUENCIADOR (núcleo Preactor) — Fases A e B
-- Reusa o que existe (maquina = recurso c/ OEE · fila_maquina · op_state_log).
-- NÃO cria tabela 'recurso' nem 'setup_matrix' (nomes já ocupados no repo).
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── estado corrente de cada máquina (o coração do determinismo por estado) ───
-- Alimentado por: inferência do último apontamento fechado (Fase C) + edição
-- manual na tela. O 1º setup do dia passa a ser REAL, não assumido.
CREATE TABLE IF NOT EXISTS estado_recurso (
    recurso_id     UUID PRIMARY KEY REFERENCES maquina(id) ON DELETE CASCADE,
    atributo_atual JSONB NOT NULL DEFAULT '{}',    -- {"galga":"7","cor_base":"preto","titulo_fio":"70"}
    livre_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    origem         TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','apontamento','sequenciador')),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE estado_recurso DISABLE ROW LEVEL SECURITY;

-- ── matriz de setup DIRECIONAL (de → para, por atributo) ─────────────────────
-- Mais rica que a setup_troca_atributo do APS (tempo por atributo): captura
-- assimetrias (branco→preto ≠ preto→branco). O lookup soma os atributos que
-- mudaram; par ausente cai no tempo genérico do atributo (setup_troca_atributo).
CREATE TABLE IF NOT EXISTS setup_transicao (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atributo   TEXT NOT NULL,                      -- 'galga' | 'cor_base' | 'titulo_fio' | 'programa_maquina'
    de_valor   TEXT NOT NULL,
    para_valor TEXT NOT NULL,
    tempo_min  NUMERIC(8,1) NOT NULL,
    UNIQUE (atributo, de_valor, para_valor)
);
ALTER TABLE setup_transicao DISABLE ROW LEVEL SECURITY;

-- ── cenários (Fase B): rodadas comparáveis, publicação em duas etapas ────────
CREATE TABLE IF NOT EXISTS cenario_comparacao (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rodada_id       TEXT NOT NULL,                 -- agrupa cenários testados juntos
    nome_cenario    TEXT NOT NULL,                 -- 'campanha' | 'prazo' | 'composto'
    regra           JSONB NOT NULL DEFAULT '{}',   -- pesos/overrides usados
    setup_total_min NUMERIC(10,1),
    ordens_atrasadas INTEGER,
    atraso_max_min  NUMERIC(10,1),
    utilizacao_gargalo_pct NUMERIC(5,2),
    makespan_min    NUMERIC(10,1),
    fila            JSONB NOT NULL DEFAULT '[]',   -- snapshot p/ publicar sem recalcular
    publicado       BOOLEAN NOT NULL DEFAULT false,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE cenario_comparacao DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cen_rodada ON cenario_comparacao(rodada_id);

-- ── fila_maquina ganha as colunas do plano fino (por tear, com horários) ─────
ALTER TABLE fila_maquina ADD COLUMN IF NOT EXISTS recurso_id UUID;
ALTER TABLE fila_maquina ADD COLUMN IF NOT EXISTS inicio     TIMESTAMPTZ;
ALTER TABLE fila_maquina ADD COLUMN IF NOT EXISTS fim        TIMESTAMPTZ;
ALTER TABLE fila_maquina ADD COLUMN IF NOT EXISTS setup_min  NUMERIC(8,1);
