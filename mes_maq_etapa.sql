-- ============================================================================
-- MES MALHA FORTE — máquina pertence a uma etapa do fluxo
-- Permite que o apontamento preencha a etapa automaticamente ao escolher a
-- máquina. Idempotente.
-- ============================================================================

ALTER TABLE maquina ADD COLUMN IF NOT EXISTS etapa_id UUID REFERENCES etapa_processo(id);

NOTIFY pgrst, 'reload schema';

-- PROVA: deve retornar 1 (coluna criada)
SELECT count(*) AS coluna_ok
FROM information_schema.columns
WHERE table_name = 'maquina' AND column_name = 'etapa_id';
