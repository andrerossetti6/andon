-- ============================================================================
-- APS — Fase 3: Política MTS/MTO por produto + kanban eletrônico
-- Produto MTS com estoque abaixo do ponto de reposição gera OP candidata
-- (origem 'kanban') sob demanda — 1 cartão ativo por produto.
-- Rode no Supabase (SQL Editor → Run). Idempotente.
-- ============================================================================

-- 1) Política de produção por SKU (NULL = não definida — nada é assumido)
ALTER TABLE produto ADD COLUMN IF NOT EXISTS politica TEXT
    CHECK (politica IN ('MTS','MTO','ATO'));
-- Lote de reposição do kanban (qtd do cartão)
ALTER TABLE produto ADD COLUMN IF NOT EXISTS lote_reposicao NUMERIC(14,3);

-- 2) Origem 'kanban' nas ordens de produção
ALTER TABLE ordem_producao DROP CONSTRAINT IF EXISTS ordem_producao_origem_check;
ALTER TABLE ordem_producao ADD CONSTRAINT ordem_producao_origem_check
    CHECK (origem IN ('erp','manual','kanban'));

NOTIFY pgrst, 'reload schema';

-- PROVA
SELECT column_name FROM information_schema.columns
WHERE table_name = 'produto' AND column_name IN ('politica','lote_reposicao');
