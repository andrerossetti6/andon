-- ============================================================================
-- MES MALHA FORTE — LEAN MANUFACTURING
-- VSM, Heijunka e Yamazumi são CALCULADOS no backend (sem schema).
-- 5S e A3/PDCA precisam de persistência → 2 tabelas. Idempotente.
-- ============================================================================

-- ── 5S: auditoria e nota por área (cada S de 0 a 5 → nota /25) ───────────────
CREATE TABLE IF NOT EXISTS auditoria_5s (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    area            TEXT NOT NULL,
    etapa_id        UUID REFERENCES etapa_processo(id) ON DELETE SET NULL,
    data_auditoria  DATE NOT NULL DEFAULT CURRENT_DATE,
    auditor         TEXT,
    seiri           INT CHECK (seiri    BETWEEN 0 AND 5),   -- utilização (descartar o desnecessário)
    seiton          INT CHECK (seiton   BETWEEN 0 AND 5),   -- organização (um lugar para cada coisa)
    seiso           INT CHECK (seiso    BETWEEN 0 AND 5),   -- limpeza
    seiketsu        INT CHECK (seiketsu BETWEEN 0 AND 5),   -- padronização
    shitsuke        INT CHECK (shitsuke BETWEEN 0 AND 5),   -- disciplina
    nota            INT GENERATED ALWAYS AS (COALESCE(seiri,0)+COALESCE(seiton,0)+COALESCE(seiso,0)+COALESCE(seiketsu,0)+COALESCE(shitsuke,0)) STORED,  -- /25
    observacao      TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE auditoria_5s DISABLE ROW LEVEL SECURITY;

-- ── A3 / PDCA: solução estruturada de problema (1 página) ────────────────────
CREATE TABLE IF NOT EXISTS a3 (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo          TEXT NOT NULL,
    etapa_id        UUID REFERENCES etapa_processo(id) ON DELETE SET NULL,
    responsavel     TEXT,
    contexto        TEXT,            -- por que (background)
    situacao_atual  TEXT,            -- o problema hoje (com dados)
    meta            TEXT,            -- objetivo
    analise         TEXT,            -- causa raiz
    contramedidas   TEXT,            -- plano de ação (Do)
    resultado       TEXT,            -- Check (verificação)
    aprendizado     TEXT,            -- Act (padronizar / próximos passos)
    fase            TEXT NOT NULL DEFAULT 'plan' CHECK (fase IN ('plan','do','check','act','concluido')),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE a3 DISABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_atual_a3 ON a3;
CREATE TRIGGER trg_atual_a3 BEFORE UPDATE ON a3 FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

NOTIFY pgrst, 'reload schema';
SELECT 'lean OK' AS status,
       (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('auditoria_5s','a3')) AS tabelas;
