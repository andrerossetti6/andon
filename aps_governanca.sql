-- ============================================================================
-- APS — Fase 1: Governança de Ordens de Produção
-- Máquina de estados auditada + estado BLOQUEADA + ledger append-only.
-- Rode no Supabase (SQL Editor → New query → Run). Idempotente.
-- ============================================================================

-- 1) Estado BLOQUEADA no CHECK da ordem_producao (hold de qualidade/material)
ALTER TABLE ordem_producao DROP CONSTRAINT IF EXISTS ordem_producao_status_check;
ALTER TABLE ordem_producao ADD CONSTRAINT ordem_producao_status_check
    CHECK (status IN ('planejada','liberada','em_producao','pausada','concluida','cancelada','bloqueada'));

-- 2) Ledger de auditoria (append-only — nunca UPDATE/DELETE via app)
CREATE TABLE IF NOT EXISTS op_state_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    op_id        UUID NOT NULL REFERENCES ordem_producao(id) ON DELETE CASCADE,
    de           TEXT,                       -- estado anterior (NULL = criação)
    para         TEXT NOT NULL,              -- estado novo
    motivo       TEXT,                       -- justificativa (obrigatória em bloqueio/override)
    disposicao   TEXT CHECK (disposicao IN ('refazer','retrabalhar','refugar','substituir','investigar')),
    origem       TEXT NOT NULL DEFAULT 'manual',  -- manual | gate | apontamento | fluxo | kanban | erp
    usuario_id   UUID,
    usuario_nome TEXT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_op_state_log_op ON op_state_log (op_id, criado_em DESC);
ALTER TABLE op_state_log DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- PROVA
SELECT to_regclass('public.op_state_log') AS op_state_log;
