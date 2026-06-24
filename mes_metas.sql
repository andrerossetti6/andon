-- ============================================================================
-- MES MALHA FORTE — Metas (config) — Onda 4 (cockpit do gestor)
-- Tabela chave-valor de metas que alimentam os alertas e o painel. Idempotente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS config_meta (
    chave         TEXT PRIMARY KEY,
    valor         NUMERIC(14,3) NOT NULL,
    descricao     TEXT,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE config_meta DISABLE ROW LEVEL SECURITY;

INSERT INTO config_meta (chave, valor, descricao) VALUES
    ('oee_meta',             85,   'Meta de OEE (%) — classe mundial ~85'),
    ('cpk_min',              1.33, 'Cpk mínimo aceitável (capabilidade)'),
    ('rnc_prazo_dias',       7,    'Prazo padrão de uma RNC (dias)'),
    ('etiqueta_alerta_dias', 3,    'Dias até alertar etiqueta de anomalia aberta'),
    ('cnq_limite_mensal',    5000, 'Limite de CNQ no mês (R$) — acima dispara alerta')
ON CONFLICT (chave) DO NOTHING;

-- ============================================================================
-- FIM — metas editáveis na tela; os alertas (/api/mf/alertas) leem daqui.
-- ============================================================================
