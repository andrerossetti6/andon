-- ============================================================================
-- MES MALHA FORTE — Qualidade v2: CNQ por etapa + Scorecard de Fornecedor
-- (Onda 1 das melhorias). Substitui vw_cnq e adiciona vw_fornecedor. Idempotente.
-- ============================================================================

-- CNQ por ETAPA: defeito gerado/pego mais adiante na cadeia acumulou mais custo.
-- fator_etapa: malharia 1.0 · tinturaria 1.5 · acabamento 2.0 · revisao 2.5
CREATE OR REPLACE VIEW vw_cnq AS
SELECT nc.id AS nc_id, nc.defeito_id, nc.disposicao, nc.qtd_afetada, nc.datahora,
       d.etapa, p.id AS produto_id, p.custo_unitario,
       (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
            WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END) AS fator_disposicao,
       (CASE d.etapa WHEN 'malharia' THEN 1.0 WHEN 'tinturaria' THEN 1.5
            WHEN 'acabamento' THEN 2.0 WHEN 'revisao' THEN 2.5 ELSE 1.0 END) AS fator_etapa,
       ROUND((nc.qtd_afetada * p.custo_unitario
            * (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
                   WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END)
            * (CASE d.etapa WHEN 'malharia' THEN 1.0 WHEN 'tinturaria' THEN 1.5
                   WHEN 'acabamento' THEN 2.0 WHEN 'revisao' THEN 2.5 ELSE 1.0 END))::numeric, 2) AS custo
FROM nao_conformidade nc
JOIN catalogo_defeito d  ON d.id  = nc.defeito_id
JOIN apontamento      a  ON a.id  = nc.apontamento_id
JOIN ordem_producao   op ON op.id = a.op_id
JOIN produto          p  ON p.id  = op.produto_id;

-- Scorecard de fornecedor: cruza lote de fio → sessões → NCs e custo CNQ.
-- Responde: "qual fornecedor de fio gera mais defeito e custo?"
CREATE OR REPLACE VIEW vw_fornecedor AS
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

-- ============================================================================
-- FIM — vw_cnq agora multiplica por etapa; vw_fornecedor é o scorecard.
-- vw_cnq_resumo e vw_cnq_defeito herdam o novo custo automaticamente.
-- ============================================================================
