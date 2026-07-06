-- ═══════════════════════════════════════════════════════════════════════════
-- N1TECH · F0 — Dados Mestres
-- Cria a única tabela de dados mestres que falta: BOM (lista técnica).
-- Roteiro (produto_etapa), tempos (tempo_padrao) e setup (setup_matrix) já
-- existem e são compartilhados — o N1Tech só os LÊ (auditoria em /api/n1/f0-auditoria).
-- Convenções do repo: PK UUID, snake_case singular, TIMESTAMPTZ, NUMERIC(14,4),
-- exclusão lógica (ativo), trigger set_atualizado_em. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bom (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    produto_id          UUID NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
    material_codigo     TEXT NOT NULL,                      -- código do fio / matéria-prima
    material_descricao  TEXT,
    qtd_por_unidade     NUMERIC(14,4) NOT NULL DEFAULT 0,   -- consumo por unidade do SKU
    unidade             TEXT NOT NULL DEFAULT 'kg' CHECK (unidade IN ('kg','g','m','pc')),
    ativo               BOOLEAN NOT NULL DEFAULT true,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (produto_id, material_codigo)
);
ALTER TABLE bom DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_bom_produto ON bom(produto_id);

-- trigger de atualizado_em (reusa a função set_atualizado_em do mes_schema, se existir)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_atualizado_em') THEN
        DROP TRIGGER IF EXISTS trg_bom_atualizado ON bom;
        CREATE TRIGGER trg_bom_atualizado BEFORE UPDATE ON bom
            FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
    END IF;
END $$;
