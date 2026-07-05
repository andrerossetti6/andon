-- ============================================================================
-- APS — Fase 5: Loop fechado (sequência congelada + detecção de DESATUALIZADO)
-- Guarda a foto da sequência aprovada; o apontamento/governança realimentam e
-- o sistema aponta divergências (bloqueio, atraso > tolerância, OP nova) sob demanda.
-- Rode no Supabase (SQL Editor → Run). Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS seq_plano (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    congelado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    usuario_id      UUID,
    usuario_nome    TEXT,
    itens           JSONB NOT NULL DEFAULT '[]',   -- [{op_id, numero, posicao, prazo, status}]
    setup_total_min NUMERIC(10,2),
    tolerancia_dias INTEGER NOT NULL DEFAULT 0,     -- atraso > isto = "relevante"
    ativo           BOOLEAN NOT NULL DEFAULT true   -- só 1 plano ativo por vez
);
CREATE INDEX IF NOT EXISTS idx_seq_plano_ativo ON seq_plano (ativo, congelado_em DESC);
ALTER TABLE seq_plano DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- PROVA
SELECT to_regclass('public.seq_plano') AS seq_plano;
