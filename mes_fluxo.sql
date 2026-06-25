-- ============================================================================
-- MES MALHA FORTE — BPM / Fluxo de processo (etapas editáveis)
-- Sequência de etapas da produção, ordenável e editável pela tela.
-- Decoupled do "etapa" do CNQ (malharia/tinturaria/…) — este é o mapa
-- operacional detalhado (Tecelagem → … → Embalagem). Idempotente.
-- ============================================================================

-- garante a função de timestamp (caso não exista)
CREATE OR REPLACE FUNCTION set_atualizado_em() RETURNS trigger AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS etapa_processo (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome          TEXT NOT NULL,
    ordem         INTEGER NOT NULL DEFAULT 0,
    ativo         BOOLEAN NOT NULL DEFAULT true,
    cor           TEXT,                          -- opcional, hex (#26c6da)
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_atual_etapa_proc ON etapa_processo;
CREATE TRIGGER trg_atual_etapa_proc BEFORE UPDATE ON etapa_processo FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE INDEX IF NOT EXISTS idx_etapa_proc_ordem ON etapa_processo (ordem);
ALTER TABLE etapa_processo DISABLE ROW LEVEL SECURITY;

-- seed inicial — só roda se a tabela estiver vazia (não sobrescreve edições)
INSERT INTO etapa_processo (nome, ordem)
SELECT v.nome, v.ordem FROM (VALUES
    ('Tecelagem', 1), ('Passadoria', 2), ('Soldagem', 3), ('Costura Manual', 4),
    ('Costura Automática', 5), ('Silicone', 6), ('Revisão', 7), ('Embalagem', 8)
) AS v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM etapa_processo);

-- força o PostgREST a recarregar o schema (senão a API responde "table not found")
NOTIFY pgrst, 'reload schema';

-- PROVA: deve retornar uma linha com o nome da tabela (não NULL) e 8 etapas
SELECT to_regclass('public.etapa_processo') AS etapa_processo,
       (SELECT count(*) FROM etapa_processo) AS qtd_etapas;
