-- ============================================================================
-- MES MALHA FORTE — CNQ (Custo da Não Qualidade) — fecha a fase 3
-- Custo de cada NC = qtd_afetada × custo_unitario_do_produto × fator(disposição).
-- Tudo é VIEW sobre nao_conformidade/apontamento/ordem_producao/produto.
-- Idempotente.
-- ============================================================================

-- custo unitário do produto (R$ por unidade_medida). Editável na tela de CNQ.
ALTER TABLE produto ADD COLUMN IF NOT EXISTS custo_unitario NUMERIC(14,4) NOT NULL DEFAULT 0;

-- Custo por NC (on-the-fly, sempre reflete o custo atual do produto)
-- Fatores de perda por disposição:
--   refugar 1.0 (perda total) · segregar 0.5 · reclassificar 0.3 · retrabalhar 0.25 · liberar 0
CREATE OR REPLACE VIEW vw_cnq AS
SELECT nc.id AS nc_id, nc.defeito_id, nc.disposicao, nc.qtd_afetada, nc.datahora,
       p.id AS produto_id, p.custo_unitario,
       (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
            WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END) AS fator,
       ROUND((nc.qtd_afetada * p.custo_unitario *
            (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
                 WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END))::numeric, 2) AS custo
FROM nao_conformidade nc
JOIN apontamento     a  ON a.id  = nc.apontamento_id
JOIN ordem_producao  op ON op.id = a.op_id
JOIN produto         p  ON p.id  = op.produto_id;

-- Resumo do CNQ (cards do painel)
CREATE OR REPLACE VIEW vw_cnq_resumo AS
SELECT COALESCE(SUM(custo), 0)                                          AS custo_total,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'refugar'), 0)    AS custo_refugo,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'retrabalhar'), 0) AS custo_retrabalho,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'segregar'), 0)   AS custo_segregado,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'reclassificar'), 0) AS custo_reclassificado,
       COUNT(*) FILTER (WHERE custo > 0)                                AS ncs_com_custo,
       COUNT(*) FILTER (WHERE custo = 0 AND custo_unitario = 0)         AS ncs_sem_custo_produto
FROM vw_cnq;

-- CNQ por defeito (Pareto de CUSTO — onde o dinheiro está vazando)
CREATE OR REPLACE VIEW vw_cnq_defeito AS
SELECT c.defeito_id, d.codigo, d.descricao, d.categoria,
       ROUND(SUM(c.custo)::numeric, 2) AS custo, COUNT(*) AS ocorrencias
FROM vw_cnq c JOIN catalogo_defeito d ON d.id = c.defeito_id
GROUP BY c.defeito_id, d.codigo, d.descricao, d.categoria
HAVING SUM(c.custo) > 0
ORDER BY custo DESC;

-- ============================================================================
-- FIM — coluna custo_unitario + 3 views de CNQ. Backfill de custo_estimado é
-- feito pelo endpoint /api/mf/cnq/recalcular (congela o custo na NC).
-- ============================================================================
