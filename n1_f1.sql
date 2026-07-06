-- ═══════════════════════════════════════════════════════════════════════════
-- N1TECH · F1 — Laço mínimo (PULL): tabelas de fluxo do spec
-- Princípio: nenhum processo chama outro — comunicação = escrita/leitura em
-- tabela. Estas são as interfaces. Idempotente (roda mais de uma vez sem dano).
--
-- NOTA ledger: o repo JÁ tem op_state_log como ledger da ordem_producao
-- (APS/kanban/ERP escrevem nele). O N1Tech REUSA esse ledger — criar um
-- segundo seria a duplicação que a consolidação removeu. Este SQL só o
-- REFORÇA como append-only (trigger bloqueia UPDATE/DELETE), como o spec pede.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ② venda_movimento — série mensal POR SKU (inclui zeros; ETL upserta) ────
CREATE TABLE IF NOT EXISTS venda_movimento (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo        TEXT NOT NULL,                 -- código do SKU (casa com produto.codigo)
    competencia   DATE NOT NULL,                 -- 1º dia do mês
    qtd           NUMERIC(14,3) NOT NULL DEFAULT 0,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (codigo, competencia)
);
ALTER TABLE venda_movimento DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_vmov_codigo ON venda_movimento(codigo);

-- ── ② estoque_posicao — posição de reposição = disponível − reservado + WIP ─
CREATE TABLE IF NOT EXISTS estoque_posicao (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo        TEXT NOT NULL UNIQUE,
    disponivel    NUMERIC(14,3) NOT NULL DEFAULT 0,
    reservado     NUMERIC(14,3) NOT NULL DEFAULT 0,
    wip           NUMERIC(14,3) NOT NULL DEFAULT 0,   -- OPs abertas (impede ordem duplicada)
    posicao       NUMERIC(14,3) GENERATED ALWAYS AS (disponivel - reservado + wip) STORED,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE estoque_posicao DISABLE ROW LEVEL SECURITY;

-- ── ⑦ politica_item — trilho PULL/PUSH (única fonte de verdade; F1=provisório) ─
CREATE TABLE IF NOT EXISTS politica_item (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo        TEXT NOT NULL UNIQUE,
    trilho        TEXT NOT NULL CHECK (trilho IN ('PULL','PUSH')),
    origem        TEXT NOT NULL DEFAULT 'provisorio' CHECK (origem IN ('provisorio','homologado')),
    motivo        TEXT,                          -- ex.: 'MTS default F1' / 'ABC-XYZ: AX' (F2)
    ciclo         TEXT,                          -- aaaa-mm da homologação (F2)
    ativo         BOOLEAN NOT NULL DEFAULT true,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE politica_item DISABLE ROW LEVEL SECURITY;

-- ── ② parametro_reposicao — pulmão TOC de 3 zonas iguais + contadores DBM ───
CREATE TABLE IF NOT EXISTS parametro_reposicao (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo           TEXT NOT NULL UNIQUE,
    mu_mensal        NUMERIC(14,3) NOT NULL DEFAULT 0,   -- μ sobre série completa (com zeros)
    sigma_mensal     NUMERIC(14,3) NOT NULL DEFAULT 0,   -- σ idem
    cv               NUMERIC(14,4),                       -- σ/μ (XYZ no F2)
    lt_dias          INTEGER NOT NULL DEFAULT 30,         -- lead time de reposição
    pulmao           NUMERIC(14,3) NOT NULL DEFAULT 0,    -- tamanho total do pulmão
    zona             NUMERIC(14,3) GENERATED ALWAYS AS (pulmao / 3.0) STORED,  -- 3 zonas iguais
    dias_vermelho    INTEGER NOT NULL DEFAULT 0,          -- contador DBM (consecutivos)
    dias_verde       INTEGER NOT NULL DEFAULT 0,          -- contador DBM (consecutivos)
    ultimo_ajuste_em TIMESTAMPTZ,                         -- máx 1 ajuste por LT
    ativo            BOOLEAN NOT NULL DEFAULT true,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE parametro_reposicao DISABLE ROW LEVEL SECURITY;

-- ── ② ordem_sugerida — saída do motor (prio 0–100); 1 PENDENTE por SKU ──────
CREATE TABLE IF NOT EXISTS ordem_sugerida (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo        TEXT NOT NULL,
    qtd           NUMERIC(14,3) NOT NULL,
    prioridade    NUMERIC(5,1) NOT NULL CHECK (prioridade >= 0 AND prioridade <= 100),
    zona_origem   TEXT NOT NULL CHECK (zona_origem IN ('PRETO','VERMELHO','AMARELO')),
    penetracao    NUMERIC(5,4),                  -- 0..1 dentro do pulmão no momento
    status        TEXT NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE','APROVADA','REJEITADA','CONVERTIDA')),
    op_id         UUID,                          -- preenchido quando vira ordem_producao
    motivo        TEXT,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ordem_sugerida DISABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sugerida_pendente ON ordem_sugerida(codigo) WHERE status = 'PENDENTE';

-- ── ④ fila_maquina — sequência versionada (PWA consome a última versão) ─────
CREATE TABLE IF NOT EXISTS fila_maquina (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    versao        INTEGER NOT NULL,
    processo      TEXT NOT NULL,                 -- ex.: 'tecelagem'
    posicao       INTEGER NOT NULL,
    op_id         UUID,
    numero        TEXT,
    codigo        TEXT,
    qtd           NUMERIC(14,3),
    cor_pulmao    TEXT CHECK (cor_pulmao IN ('PRETO','VERMELHO','AMARELO','VERDE') OR cor_pulmao IS NULL),
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (versao, processo, posicao)
);
ALTER TABLE fila_maquina DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_fila_versao ON fila_maquina(versao DESC);

-- ── ⑥ kpi_diario ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_diario (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dia                DATE NOT NULL UNIQUE,
    aderencia_pct      NUMERIC(5,1),             -- sequência seguida (null até haver fila usada)
    rupturas           INTEGER,                  -- SKUs PULL com posição ≤ 0
    penetracao_media   NUMERIC(5,1),             -- % média de penetração dos pulmões
    latencia_apont_min NUMERIC(8,1),             -- mediana (ocorrido→criado)
    detalhe            JSONB DEFAULT '{}',
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE kpi_diario DISABLE ROW LEVEL SECURITY;

-- ── ⑥ tempo_real_roteiro — realizado corrige o dado mestre (F0) ──────────────
CREATE TABLE IF NOT EXISTS tempo_real_roteiro (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    produto_id        UUID NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
    etapa_id          UUID NOT NULL,
    seg_por_unidade   NUMERIC(14,3) NOT NULL,    -- medido no chão
    amostras          INTEGER NOT NULL DEFAULT 0,
    desvio_pct        NUMERIC(6,1),              -- vs tempo_padrao cadastrado
    semanas_desvio    INTEGER NOT NULL DEFAULT 0,-- consecutivas com desvio >15%
    alerta            BOOLEAN NOT NULL DEFAULT false,
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (produto_id, etapa_id)
);
ALTER TABLE tempo_real_roteiro DISABLE ROW LEVEL SECURITY;

-- ── origem 'n1pull' nas OPs (ordem que nasce do pulmão) ──────────────────────
ALTER TABLE ordem_producao DROP CONSTRAINT IF EXISTS ordem_producao_origem_check;
ALTER TABLE ordem_producao ADD CONSTRAINT ordem_producao_origem_check
    CHECK (origem IN ('erp','manual','kanban','n1pull'));

-- ── Ledger append-only DE VERDADE (spec §2.3): bloqueia UPDATE/DELETE ────────
CREATE OR REPLACE FUNCTION bloquear_mutacao_ledger() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'op_state_log é append-only (ledger) — % proibido', TG_OP;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_ledger_appendonly ON op_state_log;
CREATE TRIGGER trg_ledger_appendonly BEFORE UPDATE OR DELETE ON op_state_log
    FOR EACH ROW EXECUTE FUNCTION bloquear_mutacao_ledger();

-- trigger de atualizado_em nas tabelas novas (reusa set_atualizado_em se existir)
DO $$
DECLARE t TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_atualizado_em') THEN
        FOREACH t IN ARRAY ARRAY['venda_movimento','politica_item','parametro_reposicao','ordem_sugerida'] LOOP
            EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_atualizado ON %s', t, t);
            EXECUTE format('CREATE TRIGGER trg_%s_atualizado BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_atualizado_em()', t, t);
        END LOOP;
    END IF;
END $$;
