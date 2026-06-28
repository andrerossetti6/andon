-- ════════════════════════════════════════════════════════════════════════════
-- FASE 1 — Espinha de dados-mestre: maquina (MES) vira a fonte ÚNICA de recurso
-- ────────────────────────────────────────────────────────────────────────────
-- A tabela 'maquina' (MES) ganha os campos que o TOC do SIGS consome (modelo do
-- tear + OEE de referência), recebe o de-para dos 11 teares Stoll do SIGS, e
-- passa a expor uma VIEW (vw_maquina_sigs) no MESMO formato que o SIGS espera de
-- 'maquinas'. ADITIVO e REVERSÍVEL: não remove nem altera nada do lado SIGS.
-- Idempotente — pode rodar de novo sem efeito colateral.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Campos novos na maquina (nuláveis — aditivo, não quebra nada existente) ----
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS modelo     TEXT;          -- modelo do tear Stoll (530/330/303)
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS oee_padrao NUMERIC(5,2);  -- OEE de referência p/ planejamento (TOC)
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS n_pessoas  INT;           -- pessoas por posto (planejamento de capacidade)

-- 2) Liga os teares à etapa Tecelagem (estava nulo no MES) ----------------------
UPDATE maquina
   SET etapa_id = (SELECT id FROM etapa_processo WHERE nome ILIKE '%Tecelagem%' ORDER BY ordem LIMIT 1)
 WHERE codigo LIKE 'STOLL-%' AND etapa_id IS NULL;

-- 3) De-para do SIGS: modelo + OEE de cada tear (fonte: maquinas 'Stoll NN') -----
UPDATE maquina SET modelo='530', oee_padrao=70 WHERE codigo='STOLL-01';
UPDATE maquina SET modelo='530', oee_padrao=70 WHERE codigo='STOLL-02';
UPDATE maquina SET modelo='330', oee_padrao=75 WHERE codigo='STOLL-03';
UPDATE maquina SET modelo='530', oee_padrao=75 WHERE codigo='STOLL-04';
UPDATE maquina SET modelo='330', oee_padrao=80 WHERE codigo='STOLL-05';
UPDATE maquina SET modelo='530', oee_padrao=78 WHERE codigo='STOLL-06';
UPDATE maquina SET modelo='330', oee_padrao=75 WHERE codigo='STOLL-07';
UPDATE maquina SET modelo='303', oee_padrao=78 WHERE codigo='STOLL-08';
UPDATE maquina SET modelo='330', oee_padrao=80 WHERE codigo='STOLL-09';
UPDATE maquina SET modelo='303', oee_padrao=80 WHERE codigo='STOLL-10';
UPDATE maquina SET modelo='330', oee_padrao=80 WHERE codigo='STOLL-11';
UPDATE maquina SET modelo='530', oee_padrao=78 WHERE codigo='STOLL-12';  -- informado por você

-- 4) VIEW de compatibilidade: 'maquina' no formato que o SIGS lê de 'maquinas' --
--    (id, processo=nome da etapa, id_maquina=codigo, modelo, oee, status, n_pessoas)
CREATE OR REPLACE VIEW vw_maquina_sigs AS
SELECT m.id,
       e.nome                                   AS processo,
       m.codigo                                 AS id_maquina,
       m.modelo,
       COALESCE(m.oee_padrao, 100)              AS oee,
       CASE WHEN m.ativo THEN 'Ativo' ELSE 'Inativo' END AS status,
       m.n_pessoas
  FROM maquina m
  LEFT JOIN etapa_processo e ON e.id = m.etapa_id;

NOTIFY pgrst, 'reload schema';

-- conferência
SELECT count(*) FILTER (WHERE modelo IS NOT NULL) AS teares_com_modelo,
       count(*) FILTER (WHERE codigo LIKE 'STOLL-%') AS total_stoll
  FROM maquina;
