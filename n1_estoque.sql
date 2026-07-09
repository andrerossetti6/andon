-- ═══════════════════════════════════════════════════════════════════════════
-- N1TECH · ESTOQUE F1 — movimentação (kardex) + posição viva
-- Princípio: NUNCA se edita saldo — se registra MOVIMENTO (ledger append-only,
-- mesmo padrão do op_state_log). Posição viva = âncora (última importação do
-- ERP) + Σ movimentos desde a âncora. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── kardex: todo evento de estoque é uma linha imutável ──────────────────────
CREATE TABLE IF NOT EXISTS estoque_movimento (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo         TEXT NOT NULL,                    -- SKU ou material (fio)
    tipo           TEXT NOT NULL CHECK (tipo IN
                     ('entrada_producao',            -- MES: sessão fechada na ÚLTIMA etapa do roteiro (qtd boa)
                      'consumo_mp',                  -- MES: BOM × qtd na PRIMEIRA etapa (fio consumido)
                      'ajuste_inventario',           -- contagem/ajuste manual (com motivo)
                      'entrada_manual',              -- recebimento avulso
                      'saida_expedicao')),           -- baixa por expedição (F3)
    delta          NUMERIC(14,3) NOT NULL,           -- COM SINAL: entrada +, consumo/saída −
    apontamento_id UUID,                             -- origem MES (rastreável)
    op_id          UUID,
    motivo         TEXT,
    usuario_nome   TEXT,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE estoque_movimento DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_emov_codigo ON estoque_movimento(codigo, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_emov_criado ON estoque_movimento(criado_em DESC);

-- append-only de verdade (reusa a função do ledger de OPs, criada no n1_f1.sql)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bloquear_mutacao_ledger') THEN
        DROP TRIGGER IF EXISTS trg_emov_appendonly ON estoque_movimento;
        CREATE TRIGGER trg_emov_appendonly BEFORE UPDATE OR DELETE ON estoque_movimento
            FOR EACH ROW EXECUTE FUNCTION bloquear_mutacao_ledger();
    END IF;
END $$;

-- ── âncora: de quando é a fotografia do ERP em estoque_posicao ───────────────
ALTER TABLE estoque_posicao ADD COLUMN IF NOT EXISTS ancora_em TIMESTAMPTZ DEFAULT NOW();
