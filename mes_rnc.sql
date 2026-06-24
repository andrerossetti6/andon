-- ============================================================================
-- MES MALHA FORTE — RNC / CAPA (loop de ação corretiva) — Onda 2
-- Quando uma NC dispara gatilho (gera_rnc), abre-se uma RNC formal que percorre:
-- aberta → em_analise (causa raiz) → em_acao (ação corretiva) → verificacao
-- (eficácia) → fechada. É o que transforma "medir" em "melhorar". Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rnc (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nc_id               UUID REFERENCES nao_conformidade(id),  -- NC que originou (NULL = aberta manual)
    defeito_id          UUID REFERENCES catalogo_defeito(id),
    maquina_id          UUID REFERENCES maquina(id),
    titulo              TEXT NOT NULL,
    descricao           TEXT,
    prioridade          TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta','critica')),
    status              TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_analise','em_acao','verificacao','fechada','cancelada')),
    responsavel_id      UUID REFERENCES operador(id),
    prazo               TIMESTAMPTZ,
    -- análise de causa raiz
    causa_raiz          TEXT,
    metodo_analise      TEXT CHECK (metodo_analise IN ('cinco_porques','ishikawa','outro')),
    -- ação corretiva
    acao_corretiva      TEXT,
    acao_concluida_em   TIMESTAMPTZ,
    -- verificação de eficácia
    eficaz              BOOLEAN,
    verificacao_obs     TEXT,
    aberta_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    fechada_em          TIMESTAMPTZ,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_atual_rnc ON rnc;
CREATE TRIGGER trg_atual_rnc BEFORE UPDATE ON rnc FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE INDEX IF NOT EXISTS idx_rnc_nc        ON rnc (nc_id);
CREATE INDEX IF NOT EXISTS idx_rnc_status    ON rnc (status);
CREATE INDEX IF NOT EXISTS idx_rnc_defeito   ON rnc (defeito_id);
CREATE INDEX IF NOT EXISTS idx_rnc_responsav ON rnc (responsavel_id);
ALTER TABLE rnc DISABLE ROW LEVEL SECURITY;

-- Resumo do quadro CAPA (cards + atrasadas)
CREATE OR REPLACE VIEW vw_rnc_resumo AS
SELECT COUNT(*) FILTER (WHERE status NOT IN ('fechada','cancelada'))                          AS abertas,
       COUNT(*) FILTER (WHERE status = 'em_analise')                                          AS em_analise,
       COUNT(*) FILTER (WHERE status = 'em_acao')                                             AS em_acao,
       COUNT(*) FILTER (WHERE status = 'verificacao')                                         AS verificacao,
       COUNT(*) FILTER (WHERE status = 'fechada')                                             AS fechadas,
       COUNT(*) FILTER (WHERE status NOT IN ('fechada','cancelada') AND prazo IS NOT NULL AND prazo < now()) AS atrasadas,
       COUNT(*) FILTER (WHERE status = 'fechada' AND eficaz = true)                           AS fechadas_eficazes
FROM rnc;

-- ============================================================================
-- FIM — tabela rnc + view de resumo. Backfill: o POST /api/mf/ncs abre uma RNC
-- automaticamente quando gera_rnc = true.
-- ============================================================================
