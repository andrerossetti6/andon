-- ============================================================================
-- APS — Fase 2: Atributos de setup + restrições físicas
-- Atributos de troca no produto (fio/galga/cor/programa), limites de galga na
-- máquina e tempos de troca por atributo (sequenciador usa na Fase 4).
-- Rode no Supabase (SQL Editor → Run). Idempotente.
-- ============================================================================

-- 1) Atributos de setup no produto (titulo_fio já existia no schema base)
ALTER TABLE produto ADD COLUMN IF NOT EXISTS galga            TEXT;   -- ex: 12, 14, E7.2
ALTER TABLE produto ADD COLUMN IF NOT EXISTS cor_base         TEXT;   -- ex: PRETA, BRANCA
ALTER TABLE produto ADD COLUMN IF NOT EXISTS programa_maquina TEXT;   -- programa/arquivo do tear

-- 2) Restrições físicas da máquina (compatibilidade produto × tear)
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS galga_min NUMERIC(5,1);
ALTER TABLE maquina ADD COLUMN IF NOT EXISTS galga_max NUMERIC(5,1);

-- 3) Tempo de troca por atributo: transição entre OPs = SOMA dos atributos que mudam.
--    (v1 por atributo, não por par de valores — documentado em DECISOES.md.
--     Minutos começam em 0: preencher com os tempos REAIS da fábrica, nada inventado.)
CREATE TABLE IF NOT EXISTS setup_troca_atributo (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atributo      TEXT NOT NULL UNIQUE CHECK (atributo IN ('titulo_fio','galga','cor_base','programa_maquina')),
    minutos       INTEGER NOT NULL DEFAULT 0,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO setup_troca_atributo (atributo, minutos) VALUES
    ('titulo_fio', 0), ('galga', 0), ('cor_base', 0), ('programa_maquina', 0)
ON CONFLICT (atributo) DO NOTHING;
ALTER TABLE setup_troca_atributo DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- PROVA
SELECT atributo, minutos FROM setup_troca_atributo ORDER BY atributo;
