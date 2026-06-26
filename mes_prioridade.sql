-- ============================================================================
-- MES MALHA FORTE — prioridade da OP (sequenciamento da fila)
-- 0 = normal · 1 = alta · 2 = urgente. A sequência sugerida ordena por
-- prioridade (desc) e depois por previsão (EDD — prazo mais cedo primeiro).
-- Idempotente.
-- ============================================================================

ALTER TABLE ordem_producao ADD COLUMN IF NOT EXISTS prioridade INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_op_prioridade ON ordem_producao (prioridade);

NOTIFY pgrst, 'reload schema';

-- PROVA: deve retornar 1 (coluna criada)
SELECT count(*) AS coluna_ok
FROM information_schema.columns
WHERE table_name = 'ordem_producao' AND column_name = 'prioridade';
