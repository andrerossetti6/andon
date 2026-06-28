-- ============================================================================
-- MES MALHA FORTE — Andon (#2): chamado em tempo real do chão
-- Operador sinaliza ajuda/parada/qualidade/material → supervisor vê e atende.
-- Escalonamento por tempo é calculado na tela (aberto_em). Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS chamado_andon (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo         TEXT NOT NULL CHECK (tipo IN ('ajuda','parada','qualidade','material')),
    etapa_id     UUID REFERENCES etapa_processo(id),
    maquina_id   UUID REFERENCES maquina(id),
    operador_id  UUID REFERENCES operador(id),
    op_id        UUID REFERENCES ordem_producao(id),
    descricao    TEXT,
    status       TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','atendido','resolvido')),
    aberto_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    atendido_em  TIMESTAMPTZ,
    resolvido_em TIMESTAMPTZ,
    atendido_por TEXT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_andon_aberto ON chamado_andon (status) WHERE status <> 'resolvido';
ALTER TABLE chamado_andon DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

SELECT to_regclass('public.chamado_andon') AS chamado_andon;
