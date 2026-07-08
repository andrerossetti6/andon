-- ============================================================================
-- APS — Fase 4: Pesos do sequenciador (regras de despacho parametrizáveis)
-- O sequenciador combina EDD + minimização de setup + prioridade comercial +
-- SPT com pesos configuráveis — sem regra hardcoded.
-- Rode no Supabase (SQL Editor → Run). Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS seq_peso (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    regra         TEXT NOT NULL UNIQUE CHECK (regra IN ('edd','setup','prioridade','spt')),
    peso          NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (peso >= 0),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Defaults (parâmetro de algoritmo, editável no APS): EDD domina (prazo primeiro),
-- setup e prioridade comercial pesam, SPT desempata.
INSERT INTO seq_peso (regra, peso) VALUES ('edd', 50), ('setup', 20), ('prioridade', 20), ('spt', 10)
ON CONFLICT (regra) DO NOTHING;
ALTER TABLE seq_peso DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- PROVA (4 linhas)
SELECT regra, peso FROM seq_peso ORDER BY regra;
