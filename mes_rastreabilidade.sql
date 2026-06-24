-- ============================================================================
-- MES MALHA FORTE — Rastreabilidade (fase 4): genealogia do lote, do fio à peça
-- lote_fio (matéria-prima) → consumo_fio (numa sessão de apontamento) → produção.
-- Permite "recall": dado um lote de fio ruim, achar tudo que ele afetou.
-- Idempotente. Pré-requisito: mes_schema.sql (apontamento, etc).
-- ============================================================================

-- 1. lote_fio — lote de matéria-prima (fio) recebido
CREATE TABLE IF NOT EXISTS lote_fio (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              TEXT NOT NULL UNIQUE,        -- nº do lote do fornecedor
    fornecedor          TEXT,
    composicao          TEXT,                         -- ex: PV 67/33
    titulo_fio          TEXT,                         -- ex: 30/1
    cor                 TEXT,
    qtd_recebida_kg     NUMERIC(14,3) NOT NULL DEFAULT 0,
    qtd_disponivel_kg   NUMERIC(14,3) NOT NULL DEFAULT 0,  -- baixa conforme consumo
    data_recebimento    TIMESTAMPTZ,
    ativo               BOOLEAN NOT NULL DEFAULT true,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. consumo_fio — qual lote de fio foi consumido em qual sessão de apontamento
CREATE TABLE IF NOT EXISTS consumo_fio (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apontamento_id   UUID NOT NULL REFERENCES apontamento(id),
    lote_fio_id      UUID NOT NULL REFERENCES lote_fio(id),
    qtd_consumida_kg NUMERIC(14,3) NOT NULL CHECK (qtd_consumida_kg > 0),
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_atual_lote_fio ON lote_fio;
CREATE TRIGGER trg_atual_lote_fio BEFORE UPDATE ON lote_fio FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE INDEX IF NOT EXISTS idx_consumo_fio_apont ON consumo_fio (apontamento_id);
CREATE INDEX IF NOT EXISTS idx_consumo_fio_lote  ON consumo_fio (lote_fio_id);

ALTER TABLE lote_fio    DISABLE ROW LEVEL SECURITY;
ALTER TABLE consumo_fio DISABLE ROW LEVEL SECURITY;

-- ── VIEW de genealogia: liga lote de fio → produção → não conformidade ────────
-- Cada linha é um consumo de fio com toda a cadeia até a peça e os defeitos.
CREATE OR REPLACE VIEW vw_genealogia AS
SELECT cf.id                AS consumo_id,
       lf.id                AS lote_fio_id,
       lf.codigo            AS lote_fio_codigo,
       lf.fornecedor,
       cf.qtd_consumida_kg,
       a.id                 AS apontamento_id,
       a.datahora_inicio,
       op.id                AS op_id,
       op.numero            AS op_numero,
       p.codigo             AS produto_codigo,
       p.descricao          AS produto_descricao,
       a.maquina_id,
       mq.codigo            AS maquina_codigo,
       (SELECT COUNT(*) FROM nao_conformidade nc WHERE nc.apontamento_id = a.id) AS ncs_na_sessao
FROM consumo_fio cf
JOIN lote_fio        lf ON lf.id = cf.lote_fio_id
JOIN apontamento     a  ON a.id  = cf.apontamento_id
JOIN ordem_producao  op ON op.id = a.op_id
JOIN produto         p  ON p.id  = op.produto_id
JOIN maquina         mq ON mq.id = a.maquina_id;

-- ============================================================================
-- FIM — 2 tabelas + 1 view de genealogia (recall do fio à peça).
-- ============================================================================
