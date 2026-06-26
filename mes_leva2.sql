-- ============================================================================
-- MES MALHA FORTE — Leva 2 (80/20): tempo padrão + CNQ honesto
-- (1) tempo_padrao: segundos por unidade por etapa (e opcional por produto) —
--     destrava capacidade/lead reais. (2) vw_cnq SEM o multiplicador de etapa
--     inventado (1.0→2.5): custo = qtd × custo_unit × fator_disposição (real).
-- Idempotente.
-- ============================================================================

CREATE OR REPLACE FUNCTION set_atualizado_em() RETURNS trigger AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── (1) TEMPO PADRÃO ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tempo_padrao (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    etapa_id        UUID NOT NULL REFERENCES etapa_processo(id) ON DELETE CASCADE,
    produto_id      UUID REFERENCES produto(id) ON DELETE CASCADE,  -- NULL = padrão da etapa
    seg_por_unidade NUMERIC(12,3) NOT NULL DEFAULT 0,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 1 padrão por etapa (produto NULL) + 1 override por produto/etapa
CREATE UNIQUE INDEX IF NOT EXISTS uq_tempo_padrao ON tempo_padrao
    (etapa_id, COALESCE(produto_id, '00000000-0000-0000-0000-000000000000'::uuid));
DROP TRIGGER IF EXISTS trg_atual_tempo_padrao ON tempo_padrao;
CREATE TRIGGER trg_atual_tempo_padrao BEFORE UPDATE ON tempo_padrao FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
ALTER TABLE tempo_padrao DISABLE ROW LEVEL SECURITY;

-- ── (2) CNQ honesto: derruba e recria sem fator_etapa ───────────────────────
DROP VIEW IF EXISTS vw_cnq CASCADE;  -- derruba também resumo/defeito/fornecedor

CREATE VIEW vw_cnq AS
SELECT nc.id AS nc_id, nc.defeito_id, nc.disposicao, nc.qtd_afetada, nc.datahora,
       p.id AS produto_id, p.custo_unitario,
       (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
            WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END) AS fator_disposicao,
       ROUND((nc.qtd_afetada * p.custo_unitario
            * (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
                   WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END))::numeric, 2) AS custo
FROM nao_conformidade nc
JOIN apontamento      a  ON a.id  = nc.apontamento_id
JOIN ordem_producao   op ON op.id = a.op_id
JOIN produto          p  ON p.id  = op.produto_id;

CREATE VIEW vw_cnq_resumo AS
SELECT COALESCE(SUM(custo), 0)                                          AS custo_total,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'refugar'), 0)    AS custo_refugo,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'retrabalhar'), 0) AS custo_retrabalho,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'segregar'), 0)   AS custo_segregado,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'reclassificar'), 0) AS custo_reclassificado,
       COUNT(*) FILTER (WHERE custo > 0)                                AS ncs_com_custo,
       COUNT(*) FILTER (WHERE custo = 0 AND custo_unitario = 0)         AS ncs_sem_custo_produto
FROM vw_cnq;

CREATE VIEW vw_cnq_defeito AS
SELECT c.defeito_id, d.codigo, d.descricao, d.categoria,
       ROUND(SUM(c.custo)::numeric, 2) AS custo, COUNT(*) AS ocorrencias
FROM vw_cnq c JOIN catalogo_defeito d ON d.id = c.defeito_id
GROUP BY c.defeito_id, d.codigo, d.descricao, d.categoria
HAVING SUM(c.custo) > 0
ORDER BY custo DESC;

CREATE VIEW vw_fornecedor AS
WITH ap_forn AS (
    SELECT DISTINCT lf.fornecedor, cf.apontamento_id
    FROM consumo_fio cf JOIN lote_fio lf ON lf.id = cf.lote_fio_id
    WHERE lf.fornecedor IS NOT NULL
),
kg AS (
    SELECT lf.fornecedor, SUM(cf.qtd_consumida_kg) AS kg
    FROM consumo_fio cf JOIN lote_fio lf ON lf.id = cf.lote_fio_id
    WHERE lf.fornecedor IS NOT NULL GROUP BY lf.fornecedor
)
SELECT af.fornecedor,
       COUNT(DISTINCT af.apontamento_id)                                              AS sessoes,
       ROUND(MAX(kg.kg)::numeric, 1)                                                  AS kg_consumido,
       COALESCE(SUM((SELECT COUNT(*) FROM nao_conformidade nc WHERE nc.apontamento_id = af.apontamento_id)), 0) AS ncs,
       ROUND(COALESCE(SUM((SELECT COALESCE(SUM(v.custo), 0) FROM vw_cnq v
              JOIN nao_conformidade nc ON nc.id = v.nc_id
              WHERE nc.apontamento_id = af.apontamento_id)), 0)::numeric, 2)          AS custo_cnq
FROM ap_forn af LEFT JOIN kg ON kg.fornecedor = af.fornecedor
GROUP BY af.fornecedor
ORDER BY ncs DESC, custo_cnq DESC;

NOTIFY pgrst, 'reload schema';

-- PROVA: tabela tempo_padrao criada (>0 colunas) e vw_cnq recriada (não NULL)
SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'tempo_padrao') AS tempo_padrao_cols,
       to_regclass('public.vw_cnq') AS vw_cnq;
