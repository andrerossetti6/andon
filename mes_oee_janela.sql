-- ─────────────────────────────────────────────────────────────
-- OEE com JANELA TEMPORAL (últimos 30 dias) — MES Malha Forte
-- A vw_oee original agregava a vida inteira da máquina: o número nunca
-- "resetava" e diluía o desempenho recente (um mês ruim há um ano ainda
-- puxava o KPI). Esta versão janela a base em 30 dias — mesmo contrato
-- de colunas, nenhum consumidor muda (painel, métricas, OKRs).
-- Rode no Supabase (SQL Editor → New query → Run).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_oee AS
WITH base AS (
    SELECT a.maquina_id,
           SUM(EXTRACT(EPOCH FROM (COALESCE(a.datahora_fim, now()) - a.datahora_inicio))) AS seg_sessao,
           SUM(a.qtd_boa)                                       AS boa,
           SUM(a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho)     AS total_prod
    FROM apontamento a
    WHERE a.datahora_inicio >= now() - interval '30 days'       -- ← janela
    GROUP BY a.maquina_id
),
par AS (
    SELECT a.maquina_id, SUM(COALESCE(p.duracao_segundos, 0)) AS seg_parada
    FROM parada p
    JOIN apontamento a   ON a.id = p.apontamento_id
    JOIN motivo_parada m ON m.id = p.motivo_id
    WHERE m.conta_oee = true
      AND a.datahora_inicio >= now() - interval '30 days'       -- ← janela (mesma base das sessões)
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
