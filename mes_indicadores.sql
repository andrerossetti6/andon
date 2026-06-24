-- ============================================================================
-- MES MALHA FORTE — Indicadores (fases 2 e 3) como VIEWS
-- OEE, Pareto de defeitos e resumo de qualidade. Tudo lê das tabelas de
-- apontamento/parada/nao_conformidade — NÃO duplica dado. Idempotente.
-- ============================================================================

-- ── OEE por máquina (Disponibilidade × Performance × Qualidade) ───────────────
-- Disponibilidade = (tempo de sessão − paradas que contam OEE) / tempo de sessão
-- Qualidade       = qtd_boa / (qtd_boa + refugo + retrabalho)
-- Performance     = produção real / (capacidade_nominal kg/h × horas operando)
CREATE OR REPLACE VIEW vw_oee AS
WITH base AS (
    SELECT a.maquina_id,
           SUM(EXTRACT(EPOCH FROM (COALESCE(a.datahora_fim, now()) - a.datahora_inicio))) AS seg_sessao,
           SUM(a.qtd_boa)                                       AS boa,
           SUM(a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho)     AS total_prod
    FROM apontamento a
    GROUP BY a.maquina_id
),
par AS (
    SELECT a.maquina_id, SUM(COALESCE(p.duracao_segundos, 0)) AS seg_parada
    FROM parada p
    JOIN apontamento a   ON a.id = p.apontamento_id
    JOIN motivo_parada m ON m.id = p.motivo_id
    WHERE m.conta_oee = true
    GROUP BY a.maquina_id
)
SELECT b.maquina_id,
       mq.codigo AS maquina_codigo,
       mq.nome   AS maquina_nome,
       ROUND((b.seg_sessao / 3600.0)::numeric, 1)                                       AS horas_sessao,
       d.disponibilidade,
       q.qualidade,
       p.performance,
       CASE WHEN d.disponibilidade IS NOT NULL AND p.performance IS NOT NULL AND q.qualidade IS NOT NULL
            THEN ROUND((d.disponibilidade * p.performance * q.qualidade / 10000.0)::numeric, 1) END AS oee
FROM base b
JOIN maquina mq ON mq.id = b.maquina_id
LEFT JOIN par ON par.maquina_id = b.maquina_id
CROSS JOIN LATERAL (
    SELECT CASE WHEN b.seg_sessao > 0
                THEN ROUND(((b.seg_sessao - COALESCE(par.seg_parada, 0)) / b.seg_sessao * 100)::numeric, 1) END AS disponibilidade
) d
CROSS JOIN LATERAL (
    SELECT CASE WHEN b.total_prod > 0
                THEN ROUND((b.boa / b.total_prod * 100)::numeric, 1) END AS qualidade
) q
CROSS JOIN LATERAL (
    SELECT CASE WHEN mq.capacidade_nominal > 0 AND (b.seg_sessao - COALESCE(par.seg_parada, 0)) > 0
                THEN LEAST(ROUND((b.total_prod / (mq.capacidade_nominal * ((b.seg_sessao - COALESCE(par.seg_parada, 0)) / 3600.0)) * 100)::numeric, 1), 999) END AS performance
) p;

-- ── Pareto de defeitos (ocorrências + qtd afetada + % acumulado) ──────────────
CREATE OR REPLACE VIEW vw_pareto_defeito AS
WITH agg AS (
    SELECT d.id   AS defeito_id, d.codigo, d.descricao, d.categoria,
           COUNT(*)             AS ocorrencias,
           SUM(nc.qtd_afetada)  AS qtd_afetada
    FROM nao_conformidade nc
    JOIN catalogo_defeito d ON d.id = nc.defeito_id
    GROUP BY d.id, d.codigo, d.descricao, d.categoria
),
tot AS (SELECT NULLIF(SUM(ocorrencias), 0) AS t FROM agg)
SELECT a.defeito_id, a.codigo, a.descricao, a.categoria, a.ocorrencias, a.qtd_afetada,
       ROUND(100.0 * a.ocorrencias / (SELECT t FROM tot), 1)                                   AS pct,
       ROUND(100.0 * SUM(a.ocorrencias) OVER (ORDER BY a.ocorrencias DESC, a.codigo) / (SELECT t FROM tot), 1) AS pct_acumulado
FROM agg a
ORDER BY a.ocorrencias DESC, a.codigo;

-- ── Resumo de qualidade / CNQ (proxy por disposição enquanto custo é fase 3) ──
CREATE OR REPLACE VIEW vw_qualidade_resumo AS
SELECT
    COUNT(*)                                                       AS total_ncs,
    COALESCE(SUM(qtd_afetada), 0)                                  AS qtd_total_afetada,
    COALESCE(SUM(qtd_afetada) FILTER (WHERE disposicao = 'refugar'), 0)       AS qtd_refugada,
    COALESCE(SUM(qtd_afetada) FILTER (WHERE disposicao = 'retrabalhar'), 0)   AS qtd_retrabalho,
    COALESCE(SUM(qtd_afetada) FILTER (WHERE disposicao = 'segregar'), 0)      AS qtd_segregada,
    COALESCE(SUM(qtd_afetada) FILTER (WHERE disposicao = 'reclassificar'), 0) AS qtd_reclassificada,
    COUNT(*) FILTER (WHERE gera_rnc)                               AS rncs_geradas,
    COUNT(*) FILTER (WHERE severidade_aplicada = 4)                AS criticas
FROM nao_conformidade;

-- ── Qualidade por categoria de defeito (para o donut/quebra) ──────────────────
CREATE OR REPLACE VIEW vw_qualidade_categoria AS
SELECT d.categoria,
       COUNT(*)            AS ocorrencias,
       SUM(nc.qtd_afetada) AS qtd_afetada
FROM nao_conformidade nc
JOIN catalogo_defeito d ON d.id = nc.defeito_id
GROUP BY d.categoria
ORDER BY ocorrencias DESC;

-- ============================================================================
-- FIM — 4 views de indicadores. Leem das tabelas de captura, sem duplicar dado.
-- ============================================================================
