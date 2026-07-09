-- ═══════════════════════════════════════════════════════════════════════════
-- N1TECH · ESTOQUE F2 — reconciliação sistema × ERP (acuracidade / IRA)
-- A cada reimportação de estoque, o ETL compara a posição que o SISTEMA
-- calculou (âncora anterior + movimentos) com o novo snapshot do ERP e grava
-- as divergências aqui, ANTES de re-ancorar. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS estoque_reconciliacao (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    executado_em TIMESTAMPTZ NOT NULL,             -- agrupa a "rodada" (mesma p/ todos os códigos da run)
    codigo       TEXT NOT NULL,
    sistema      NUMERIC(14,3) NOT NULL,           -- o que o sistema calculava (viva) na hora da importação
    erp          NUMERIC(14,3) NOT NULL,           -- o que o ERP trouxe
    divergencia  NUMERIC(14,3) NOT NULL,           -- sistema − erp
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE estoque_reconciliacao DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_erec_run ON estoque_reconciliacao(executado_em DESC);
CREATE INDEX IF NOT EXISTS idx_erec_codigo ON estoque_reconciliacao(codigo);
