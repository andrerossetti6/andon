-- ============================================================================
-- MES MALHA FORTE — Módulo TPM / Manutenção (fase 5)
-- 10 tabelas + 4 VIEWS (MTBF, MTTR, cumprimento do CIL, etiquetas abertas).
-- As VIEWS leem das tabelas existentes (parada, apontamento, motivo_parada,
-- nao_conformidade) sem duplicar dado. Idempotente.
-- Pré-requisito: mes_schema.sql já aplicado (maquina, operador, turno, parada).
-- ============================================================================

-- usa o trigger genérico já criado em mes_schema.sql: set_atualizado_em()

-- 1. componente — sub-ativos da máquina ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS componente (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id        UUID NOT NULL REFERENCES maquina(id),
    codigo            TEXT NOT NULL UNIQUE,
    nome              TEXT NOT NULL,
    tipo              TEXT NOT NULL CHECK (tipo IN ('desgaste','mecanico','eletrico','pneumatico','outro')),
    vida_util_valor   NUMERIC(12,2),
    vida_util_unidade TEXT CHECK (vida_util_unidade IN ('horas','kg','ciclos','dias')),
    ativo             BOOLEAN NOT NULL DEFAULT true,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. plano_manutencao — preventiva e preditiva ────────────────────────────────
CREATE TABLE IF NOT EXISTS plano_manutencao (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id           UUID NOT NULL REFERENCES maquina(id),
    componente_id        UUID REFERENCES componente(id),
    nome                 TEXT NOT NULL,
    tipo                 TEXT NOT NULL CHECK (tipo IN ('preventiva','preditiva','lubrificacao','inspecao')),
    gatilho              TEXT NOT NULL CHECK (gatilho IN ('calendario','contador')),
    intervalo_valor      NUMERIC(12,2) NOT NULL,
    intervalo_unidade    TEXT NOT NULL CHECK (intervalo_unidade IN ('dias','horas','kg','ciclos')),
    instrucoes           TEXT,
    duracao_estimada_min INT,
    ativo                BOOLEAN NOT NULL DEFAULT true,
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. peca — sobressalentes (antes de ordem_manutencao p/ consumo_peca depois) ──
CREATE TABLE IF NOT EXISTS peca (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          TEXT NOT NULL UNIQUE,
    nome            TEXT NOT NULL,
    categoria       TEXT,
    estoque_atual   NUMERIC(12,3) NOT NULL DEFAULT 0,
    estoque_minimo  NUMERIC(12,3) NOT NULL DEFAULT 0,
    unidade         TEXT NOT NULL CHECK (unidade IN ('un','kg','m','jogo')),
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. ordem_manutencao — OM (tempo_reparo_min é coluna gerada) ──────────────────
CREATE TABLE IF NOT EXISTS ordem_manutencao (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id       UUID NOT NULL REFERENCES maquina(id),
    componente_id    UUID REFERENCES componente(id),
    plano_id         UUID REFERENCES plano_manutencao(id),
    parada_id        UUID REFERENCES parada(id),       -- liga corretiva à quebra
    tipo             TEXT NOT NULL CHECK (tipo IN ('corretiva','preventiva','preditiva')),
    prioridade       TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta','urgente')),
    status           TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','planejada','em_execucao','concluida','cancelada')),
    descricao        TEXT NOT NULL,
    executor_id      UUID REFERENCES operador(id),
    aberta_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    iniciada_em      TIMESTAMPTZ,
    concluida_em     TIMESTAMPTZ,
    tempo_reparo_min INT GENERATED ALWAYS AS ((EXTRACT(EPOCH FROM (concluida_em - iniciada_em)) / 60)::int) STORED,
    causa            TEXT,
    acao_realizada   TEXT,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. etiqueta_anomalia — TPM tag do operador ──────────────────────────────────
CREATE TABLE IF NOT EXISTS etiqueta_anomalia (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id          UUID NOT NULL REFERENCES maquina(id),
    componente_id       UUID REFERENCES componente(id),
    operador_id         UUID NOT NULL REFERENCES operador(id),
    tipo                TEXT NOT NULL CHECK (tipo IN ('seguranca','qualidade','quebra_iminente','lubrificacao','limpeza','outro')),
    gravidade           TEXT NOT NULL DEFAULT 'media' CHECK (gravidade IN ('baixa','media','alta')),
    descricao           TEXT NOT NULL,
    foto_url            TEXT,
    status              TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_tratativa','resolvida')),
    ordem_manutencao_id UUID REFERENCES ordem_manutencao(id),
    aberta_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolvida_em        TIMESTAMPTZ,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. checklist_autonoma — template do CIL ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_autonoma (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id    UUID REFERENCES maquina(id),          -- NULL = vale p/ um tipo
    tipo_maquina  TEXT CHECK (tipo_maquina IN ('circular','retilinea','tear','rama','tinturaria','revisao','outro')),
    nome          TEXT NOT NULL,
    frequencia    TEXT NOT NULL CHECK (frequencia IN ('turno','diaria','semanal')),
    ativo         BOOLEAN NOT NULL DEFAULT true,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. checklist_item — itens do CIL ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_item (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id UUID NOT NULL REFERENCES checklist_autonoma(id),
    ordem        INT NOT NULL,
    descricao    TEXT NOT NULL,
    tipo         TEXT NOT NULL CHECK (tipo IN ('limpeza','inspecao','lubrificacao')),
    referencia   TEXT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. checklist_execucao — operador cumpre a rotina ────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_execucao (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id UUID NOT NULL REFERENCES checklist_autonoma(id),
    maquina_id   UUID NOT NULL REFERENCES maquina(id),
    operador_id  UUID NOT NULL REFERENCES operador(id),
    turno_id     UUID NOT NULL REFERENCES turno(id),
    executado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    status       TEXT NOT NULL CHECK (status IN ('completo','parcial')),
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. checklist_execucao_item — resultado item a item ──────────────────────────
CREATE TABLE IF NOT EXISTS checklist_execucao_item (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execucao_id UUID NOT NULL REFERENCES checklist_execucao(id),
    item_id     UUID NOT NULL REFERENCES checklist_item(id),
    resultado   TEXT NOT NULL CHECK (resultado IN ('ok','nao_ok','nao_aplicavel')),
    observacao  TEXT,
    etiqueta_id UUID REFERENCES etiqueta_anomalia(id),
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. consumo_peca — peças usadas numa OM ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS consumo_peca (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ordem_manutencao_id UUID NOT NULL REFERENCES ordem_manutencao(id),
    peca_id             UUID NOT NULL REFERENCES peca(id),
    quantidade          NUMERIC(12,3) NOT NULL CHECK (quantidade > 0),
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Triggers de atualizado_em ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_atual_componente        ON componente;
CREATE TRIGGER trg_atual_componente        BEFORE UPDATE ON componente        FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_plano_manut       ON plano_manutencao;
CREATE TRIGGER trg_atual_plano_manut       BEFORE UPDATE ON plano_manutencao   FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_peca              ON peca;
CREATE TRIGGER trg_atual_peca              BEFORE UPDATE ON peca               FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_ordem_manut       ON ordem_manutencao;
CREATE TRIGGER trg_atual_ordem_manut       BEFORE UPDATE ON ordem_manutencao   FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_etiqueta          ON etiqueta_anomalia;
CREATE TRIGGER trg_atual_etiqueta          BEFORE UPDATE ON etiqueta_anomalia  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_checklist_auto    ON checklist_autonoma;
CREATE TRIGGER trg_atual_checklist_auto    BEFORE UPDATE ON checklist_autonoma FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- ── Índices (FKs) ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_componente_maquina   ON componente            (maquina_id);
CREATE INDEX IF NOT EXISTS idx_plano_maquina        ON plano_manutencao      (maquina_id);
CREATE INDEX IF NOT EXISTS idx_plano_componente     ON plano_manutencao      (componente_id);
CREATE INDEX IF NOT EXISTS idx_om_maquina           ON ordem_manutencao      (maquina_id);
CREATE INDEX IF NOT EXISTS idx_om_componente        ON ordem_manutencao      (componente_id);
CREATE INDEX IF NOT EXISTS idx_om_plano             ON ordem_manutencao      (plano_id);
CREATE INDEX IF NOT EXISTS idx_om_parada            ON ordem_manutencao      (parada_id);
CREATE INDEX IF NOT EXISTS idx_om_executor          ON ordem_manutencao      (executor_id);
CREATE INDEX IF NOT EXISTS idx_etiq_maquina         ON etiqueta_anomalia     (maquina_id);
CREATE INDEX IF NOT EXISTS idx_etiq_componente      ON etiqueta_anomalia     (componente_id);
CREATE INDEX IF NOT EXISTS idx_etiq_operador        ON etiqueta_anomalia     (operador_id);
CREATE INDEX IF NOT EXISTS idx_etiq_om              ON etiqueta_anomalia     (ordem_manutencao_id);
CREATE INDEX IF NOT EXISTS idx_clitem_checklist     ON checklist_item        (checklist_id);
CREATE INDEX IF NOT EXISTS idx_clexec_checklist     ON checklist_execucao    (checklist_id);
CREATE INDEX IF NOT EXISTS idx_clexec_maquina       ON checklist_execucao    (maquina_id);
CREATE INDEX IF NOT EXISTS idx_clexec_operador      ON checklist_execucao    (operador_id);
CREATE INDEX IF NOT EXISTS idx_clexec_turno         ON checklist_execucao    (turno_id);
CREATE INDEX IF NOT EXISTS idx_clexecitem_exec      ON checklist_execucao_item (execucao_id);
CREATE INDEX IF NOT EXISTS idx_clexecitem_item      ON checklist_execucao_item (item_id);
CREATE INDEX IF NOT EXISTS idx_clexecitem_etiq      ON checklist_execucao_item (etiqueta_id);
CREATE INDEX IF NOT EXISTS idx_consumo_om           ON consumo_peca          (ordem_manutencao_id);
CREATE INDEX IF NOT EXISTS idx_consumo_peca         ON consumo_peca          (peca_id);

-- ── DISABLE RLS (Supabase; no-op em Postgres puro) ────────────────────────────
ALTER TABLE componente              DISABLE ROW LEVEL SECURITY;
ALTER TABLE plano_manutencao        DISABLE ROW LEVEL SECURITY;
ALTER TABLE peca                    DISABLE ROW LEVEL SECURITY;
ALTER TABLE ordem_manutencao        DISABLE ROW LEVEL SECURITY;
ALTER TABLE etiqueta_anomalia       DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_autonoma      DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_item          DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_execucao      DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_execucao_item DISABLE ROW LEVEL SECURITY;
ALTER TABLE consumo_peca            DISABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════════
-- VIEWS (indicadores) — leem das tabelas existentes, NÃO duplicam dado
-- ════════════════════════════════════════════════════════════════════════════

-- MTTR: média do tempo de reparo das corretivas, por máquina
CREATE OR REPLACE VIEW vw_mttr AS
SELECT maquina_id,
       COUNT(*)                       AS corretivas,
       ROUND(AVG(tempo_reparo_min))   AS mttr_min
FROM ordem_manutencao
WHERE tipo = 'corretiva' AND tempo_reparo_min IS NOT NULL
GROUP BY maquina_id;

-- MTBF: horas produtivas ÷ nº de quebras (paradas de manutenção), por máquina
CREATE OR REPLACE VIEW vw_mtbf AS
WITH prod AS (
    SELECT maquina_id,
           SUM(EXTRACT(EPOCH FROM (COALESCE(datahora_fim, now()) - datahora_inicio)) / 3600.0) AS horas_op
    FROM apontamento GROUP BY maquina_id
), quebras AS (
    SELECT a.maquina_id, COUNT(*) AS n
    FROM parada p
    JOIN apontamento a   ON a.id = p.apontamento_id
    JOIN motivo_parada m ON m.id = p.motivo_id
    WHERE m.categoria = 'manutencao'
    GROUP BY a.maquina_id
)
SELECT pr.maquina_id,
       ROUND(pr.horas_op::numeric, 1)                          AS horas_operadas,
       COALESCE(q.n, 0)                                        AS quebras,
       CASE WHEN COALESCE(q.n, 0) > 0
            THEN ROUND((pr.horas_op / q.n)::numeric, 1) END    AS mtbf_horas
FROM prod pr LEFT JOIN quebras q ON q.maquina_id = pr.maquina_id;

-- Cumprimento do CIL: execuções 'completo' ÷ total, por máquina
CREATE OR REPLACE VIEW vw_cil_cumprimento AS
SELECT maquina_id,
       COUNT(*) FILTER (WHERE status = 'completo') AS completas,
       COUNT(*)                                    AS execucoes,
       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completo') / NULLIF(COUNT(*), 0), 1) AS pct_cumprimento
FROM checklist_execucao
GROUP BY maquina_id;

-- Etiquetas abertas e idade média, por máquina
CREATE OR REPLACE VIEW vw_etiquetas_abertas AS
SELECT maquina_id,
       COUNT(*)                                                              AS abertas,
       ROUND(AVG(EXTRACT(EPOCH FROM (now() - aberta_em)) / 86400.0)::numeric, 1) AS idade_media_dias
FROM etiqueta_anomalia
WHERE status <> 'resolvida'
GROUP BY maquina_id;

-- ============================================================================
-- FIM — 10 tabelas + 4 views. Sem telas (fase 5 é schema + indicadores).
-- ============================================================================
