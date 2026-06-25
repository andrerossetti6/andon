-- ============================================================================
-- MES MALHA FORTE — atributos de produto vindos do ERP (cor/marca/tamanho)
-- Usados pela importação de OPs do ERP, que cria o produto a partir do próprio
-- arquivo de Ordens de Produção. Idempotente.
-- ============================================================================

ALTER TABLE produto ADD COLUMN IF NOT EXISTS cor     TEXT;
ALTER TABLE produto ADD COLUMN IF NOT EXISTS marca   TEXT;
ALTER TABLE produto ADD COLUMN IF NOT EXISTS tamanho TEXT;

NOTIFY pgrst, 'reload schema';

-- PROVA: deve retornar 3 (as três colunas criadas)
SELECT count(*) AS colunas_ok
FROM information_schema.columns
WHERE table_name = 'produto' AND column_name IN ('cor', 'marca', 'tamanho');
