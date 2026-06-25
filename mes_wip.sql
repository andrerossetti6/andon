-- ============================================================================
-- MES MALHA FORTE — WIP / Kanban de produção (cada etapa = buffer de WIP)
-- A OP entra numa etapa (entrou_em) e sai quando avança (saiu_em). O WIP atual
-- de uma etapa = movimentos abertos (saiu_em IS NULL). Lead time por etapa sai
-- da diferença entrou→saiu dos movimentos concluídos. Idempotente.
-- ============================================================================

-- garante a função de timestamp (caso não exista)
CREATE OR REPLACE FUNCTION set_atualizado_em() RETURNS trigger AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- limite de WIP por etapa (acima dele = gargalo). NULL = sem limite.
ALTER TABLE etapa_processo ADD COLUMN IF NOT EXISTS limite_wip INTEGER;

CREATE TABLE IF NOT EXISTS fluxo_movimento (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    op_id       UUID NOT NULL REFERENCES ordem_producao(id) ON DELETE CASCADE,
    etapa_id    UUID NOT NULL REFERENCES etapa_processo(id),
    qtd         NUMERIC(14,3) NOT NULL DEFAULT 0,
    entrou_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    saiu_em     TIMESTAMPTZ,                    -- NULL = ainda parado nesta etapa (WIP)
    operador_id UUID,
    obs         TEXT,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fluxo_mov_aberto ON fluxo_movimento (etapa_id) WHERE saiu_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_fluxo_mov_op     ON fluxo_movimento (op_id);
ALTER TABLE fluxo_movimento DISABLE ROW LEVEL SECURITY;

-- WIP atual por etapa (nº de OPs e quantidade parada)
CREATE OR REPLACE VIEW vw_wip_etapa AS
SELECT e.id AS etapa_id, e.nome, e.ordem, e.limite_wip,
       COUNT(m.id)            AS ops,
       COALESCE(SUM(m.qtd),0) AS qtd_wip
FROM etapa_processo e
LEFT JOIN fluxo_movimento m ON m.etapa_id = e.id AND m.saiu_em IS NULL
WHERE e.ativo = true
GROUP BY e.id, e.nome, e.ordem, e.limite_wip;

-- Lead time médio por etapa (horas) dos movimentos já concluídos
CREATE OR REPLACE VIEW vw_wip_leadtime AS
SELECT etapa_id,
       COUNT(*)                                                                AS concluidos,
       ROUND(AVG(EXTRACT(EPOCH FROM (saiu_em - entrou_em)) / 3600.0)::numeric, 2) AS horas_medias
FROM fluxo_movimento
WHERE saiu_em IS NOT NULL
GROUP BY etapa_id;

NOTIFY pgrst, 'reload schema';

-- PROVA: deve retornar o nome da tabela (não NULL)
SELECT to_regclass('public.fluxo_movimento') AS fluxo_movimento;
