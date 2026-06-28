-- ============================================================================
-- MES MALHA FORTE — Roteiro por produto (#1): quais etapas cada produto usa
-- Sem linhas para um produto = usa TODAS as etapas (compatível com o atual).
-- Com linhas = usa só essas (na ordem de etapa_processo.ordem). O fluxo
-- (entrar/avançar/voltar) e a capacidade passam a respeitar o roteiro.
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS produto_etapa (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    produto_id  UUID NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
    etapa_id    UUID NOT NULL REFERENCES etapa_processo(id) ON DELETE CASCADE,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produto_etapa ON produto_etapa (produto_id, etapa_id);
CREATE INDEX IF NOT EXISTS idx_produto_etapa_prod ON produto_etapa (produto_id);
ALTER TABLE produto_etapa DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- PROVA: nome da tabela (não NULL)
SELECT to_regclass('public.produto_etapa') AS produto_etapa;
