-- ============================================================================
-- MES MALHA FORTE — Documentos (#7): instrução de trabalho na estação
-- Um documento pode valer para um produto, uma etapa, ambos, ou geral (ambos
-- nulos). O operador vê na sessão os documentos do seu produto+etapa. Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS documento (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo      TEXT NOT NULL,
    produto_id  UUID REFERENCES produto(id) ON DELETE CASCADE,        -- null = qualquer produto
    etapa_id    UUID REFERENCES etapa_processo(id) ON DELETE CASCADE,  -- null = qualquer etapa
    url         TEXT,            -- link (PDF/desenho) — opcional
    conteudo    TEXT,            -- texto da instrução — opcional
    ativo       BOOLEAN NOT NULL DEFAULT true,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doc_prod  ON documento (produto_id);
CREATE INDEX IF NOT EXISTS idx_doc_etapa ON documento (etapa_id);
ALTER TABLE documento DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

SELECT to_regclass('public.documento') AS documento;
