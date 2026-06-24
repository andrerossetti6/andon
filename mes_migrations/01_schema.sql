-- ============================================================================
-- MES MALHA FORTE — Schema (Fases 0 e 1: fundação, apontamento e qualidade)
-- Banco-alvo: PostgreSQL 15+ (gen_random_uuid() nativo)
-- Idempotente: pode ser rodado mais de uma vez sem erro.
-- ============================================================================
-- Convenções aplicadas:
--   • PK UUID DEFAULT gen_random_uuid()
--   • criado_em / atualizado_em TIMESTAMPTZ (atualizado_em via trigger)
--   • Exclusão lógica: cadastros têm ativo BOOLEAN DEFAULT true
--   • TEXT + CHECK para enums (nunca VARCHAR; nunca tipo ENUM nativo)
--   • Dinheiro NUMERIC(14,4); quantidades NUMERIC(14,3); nunca FLOAT
--   • snake_case, tabela no singular
--
-- Decisões de leitura da spec (ambiguidades resolvidas):
--   • turno, gatilho_rnc, motivo_parada: a spec não listou criado_em/atualizado_em,
--     mas a convenção diz "TODAS as tabelas" — então foram incluídos + trigger.
--   • de_para_defeito, parada, foto: a spec listou só criado_em (registros
--     imutáveis/append) — respeitado, sem atualizado_em nem trigger.
--   • DISABLE ROW LEVEL SECURITY ao final: necessário no Supabase (service_role);
--     no-op em PostgreSQL puro.
-- ============================================================================

-- ── Trigger genérico de atualizado_em (nota 1) ──────────────────────────────
CREATE OR REPLACE FUNCTION set_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ════════════════════════════════════════════════════════════════════════════
-- CADASTROS BASE
-- ════════════════════════════════════════════════════════════════════════════

-- 4. turno ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS turno (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          TEXT NOT NULL UNIQUE CHECK (codigo IN ('A','B','C')),
    descricao       TEXT,
    hora_inicio     TIME NOT NULL,
    hora_fim        TIME NOT NULL,           -- pode cruzar a meia-noite
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1. produto ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS produto (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          TEXT NOT NULL UNIQUE,    -- espelha o código do ERP
    descricao       TEXT NOT NULL,
    composicao      TEXT,
    titulo_fio      TEXT,
    gramatura_alvo  NUMERIC(8,2),            -- g/m² — limite-alvo no CEP (fase 2)
    largura_alvo    NUMERIC(8,2),            -- cm
    unidade_medida  TEXT NOT NULL CHECK (unidade_medida IN ('kg','m','pc')),
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. maquina ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maquina (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              TEXT NOT NULL UNIQUE,
    nome                TEXT NOT NULL,
    tipo                TEXT NOT NULL CHECK (tipo IN ('circular','retilinea','tear','rama','tinturaria','revisao','outro')),
    setor               TEXT NOT NULL CHECK (setor IN ('malharia','tinturaria','acabamento','revisao')),
    finura              NUMERIC(5,1),         -- galga (agulhas/pol) — circular/retilínea
    diametro_pol        NUMERIC(5,1),         -- só circular
    num_alimentadores   INT,                  -- só circular
    velocidade_nominal  NUMERIC(10,2),        -- RPM ou m/min — fator performance do OEE
    unidade_velocidade  TEXT CHECK (unidade_velocidade IN ('rpm','m_min')),
    capacidade_nominal  NUMERIC(10,2),        -- kg/h — base do OEE
    ativo               BOOLEAN NOT NULL DEFAULT true,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. operador ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operador (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    matricula       TEXT NOT NULL UNIQUE,
    nome            TEXT NOT NULL,
    setor           TEXT CHECK (setor IN ('malharia','tinturaria','acabamento','revisao')),
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. motivo_parada ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS motivo_parada (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          TEXT NOT NULL UNIQUE,
    descricao       TEXT NOT NULL,
    categoria       TEXT NOT NULL CHECK (categoria IN ('setup','manutencao','falta_material','qualidade','operacional','planejada')),
    planejada       BOOLEAN NOT NULL DEFAULT false,  -- parada planejada não penaliza OEE
    conta_oee       BOOLEAN NOT NULL DEFAULT true,    -- entra no cálculo de disponibilidade
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. catalogo_defeito ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalogo_defeito (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              TEXT NOT NULL UNIQUE,
    descricao           TEXT NOT NULL,
    categoria           TEXT NOT NULL CHECK (categoria IN ('malha','cor','fio','dimensional','sujeira','acabamento')),
    etapa               TEXT NOT NULL CHECK (etapa IN ('malharia','tinturaria','acabamento','revisao')),
    severidade          INT  NOT NULL CHECK (severidade BETWEEN 1 AND 4),  -- 1=cosmético, 4=crítico
    disposicao_padrao   TEXT CHECK (disposicao_padrao IN ('liberar','retrabalhar','refugar','segregar','reclassificar')),
    foto_referencia_url TEXT,
    ativo               BOOLEAN NOT NULL DEFAULT true,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. de_para_defeito (PK = termo_legado; só criado_em) ────────────────────────
CREATE TABLE IF NOT EXISTS de_para_defeito (
    termo_legado    TEXT PRIMARY KEY,         -- termo NORMALIZADO: minúsculo, sem acento, trim
    defeito_id      UUID NOT NULL REFERENCES catalogo_defeito(id),
    fonte           TEXT NOT NULL CHECK (fonte IN ('semente','aprovado_agente','manual')),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. gatilho_rnc ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gatilho_rnc (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo            TEXT NOT NULL CHECK (tipo IN ('volume','recorrencia')),
    defeito_id      UUID REFERENCES catalogo_defeito(id),  -- NULL = qualquer defeito
    categoria       TEXT CHECK (categoria IN ('malha','cor','fio','dimensional','sujeira','acabamento')),  -- alternativa ao defeito_id
    limiar          NUMERIC(10,3) NOT NULL,   -- volume: qtd ou %; recorrência: nº ocorrências
    unidade_limiar  TEXT NOT NULL CHECK (unidade_limiar IN ('qtd','percentual','ocorrencias')),
    janela_horas    INT,                      -- só recorrência
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════════════════
-- PRODUÇÃO E EXECUÇÃO
-- ════════════════════════════════════════════════════════════════════════════

-- 8. ordem_producao ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordem_producao (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero              TEXT NOT NULL UNIQUE,           -- espelha o ERP
    produto_id          UUID NOT NULL REFERENCES produto(id),
    qtd_planejada       NUMERIC(14,3) NOT NULL,
    unidade             TEXT NOT NULL CHECK (unidade IN ('kg','m','pc')),
    maquina_prevista_id UUID REFERENCES maquina(id),
    data_abertura       TIMESTAMPTZ,
    data_prevista       TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'planejada'
                         CHECK (status IN ('planejada','liberada','em_producao','pausada','concluida','cancelada')),
    origem              TEXT NOT NULL DEFAULT 'erp' CHECK (origem IN ('erp','manual')),
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. apontamento (registro-raiz: sessão de trabalho) ──────────────────────────
CREATE TABLE IF NOT EXISTS apontamento (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    op_id               UUID NOT NULL REFERENCES ordem_producao(id),
    maquina_id          UUID NOT NULL REFERENCES maquina(id),
    operador_id         UUID NOT NULL REFERENCES operador(id),
    turno_id            UUID NOT NULL REFERENCES turno(id),
    datahora_inicio     TIMESTAMPTZ NOT NULL,
    datahora_fim        TIMESTAMPTZ,                    -- NULL = sessão aberta
    qtd_boa             NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qtd_boa        >= 0),
    qtd_refugo          NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qtd_refugo     >= 0),
    qtd_retrabalho      NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qtd_retrabalho >= 0),
    unidade             TEXT NOT NULL CHECK (unidade IN ('kg','m','pc')),
    dispositivo_id      TEXT,                           -- tablet que registrou
    sincronizado_em     TIMESTAMPTZ,                    -- NULL = ainda local (fila offline)
    origem              TEXT NOT NULL DEFAULT 'pwa' CHECK (origem IN ('pwa','legado','manual')),
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. parada (só criado_em; duracao_segundos é coluna gerada — nota 3) ─────────
CREATE TABLE IF NOT EXISTS parada (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apontamento_id      UUID NOT NULL REFERENCES apontamento(id),
    motivo_id           UUID NOT NULL REFERENCES motivo_parada(id),
    datahora_inicio     TIMESTAMPTZ NOT NULL,
    datahora_fim        TIMESTAMPTZ,                    -- NULL = parada em curso
    duracao_segundos    INT GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (datahora_fim - datahora_inicio))::int) STORED,
    observacao          TEXT,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. nao_conformidade (o registro com foto) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS nao_conformidade (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apontamento_id      UUID NOT NULL REFERENCES apontamento(id),
    defeito_id          UUID NOT NULL REFERENCES catalogo_defeito(id),
    qtd_afetada         NUMERIC(14,3) NOT NULL CHECK (qtd_afetada > 0),
    unidade             TEXT NOT NULL CHECK (unidade IN ('kg','m','pc')),
    disposicao          TEXT NOT NULL CHECK (disposicao IN ('liberar','retrabalhar','refugar','segregar','reclassificar')),
    severidade_aplicada INT  NOT NULL CHECK (severidade_aplicada BETWEEN 1 AND 4),  -- congelada (nota 4)
    posicao             TEXT,                           -- ex: "agulha 340", "lateral"
    causa_preliminar    TEXT,
    gera_rnc            BOOLEAN NOT NULL DEFAULT false,  -- true se algum gatilho disparou
    custo_estimado      NUMERIC(14,4),                  -- preenchido pelo CNQ (fase 3) — NULL agora
    origem_legado       TEXT,                           -- texto original do defeito quando importado
    datahora            TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. foto (só criado_em; binário fica no storage) ────────────────────────────
CREATE TABLE IF NOT EXISTS foto (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nc_id           UUID NOT NULL REFERENCES nao_conformidade(id),
    url             TEXT NOT NULL,
    nome_arquivo    TEXT,
    tamanho_bytes   INT,
    largura_px      INT,
    altura_px       INT,
    capturada_em    TIMESTAMPTZ,
    metadados       JSONB,                    -- EXIF, geo, modelo do dispositivo
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════════════════
-- STAGING (carga do legado)
-- ════════════════════════════════════════════════════════════════════════════
-- A spec diz "tabela larga, tudo TEXT, espelha a planilha + colunas de controle"
-- e remete os detalhes à spec do importador. Como as colunas da planilha ainda
-- não estão definidas, a linha bruta vai em linha_bruta JSONB (placeholder) e os
-- campos de controle vão tipados. Quando o importador for especificado, as
-- colunas largas TEXT podem ser adicionadas via ALTER TABLE.
CREATE TABLE IF NOT EXISTS stg_importacao (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lote_id         UUID NOT NULL,            -- agrupa uma carga
    linha_origem    INT,                      -- nº da linha na planilha
    linha_bruta     JSONB,                    -- a linha da planilha (tudo TEXT por chave)
    defeito_id      UUID REFERENCES catalogo_defeito(id),  -- preenchido na normalização
    metodo_traducao TEXT CHECK (metodo_traducao IN ('exato','fuzzy','agente','manual')),
    confianca       NUMERIC(5,4) CHECK (confianca BETWEEN 0 AND 1),
    status          TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','valido','rejeitado','carregado')),
    erros           TEXT[],
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ════════════════════════════════════════════════════════════════════════════
-- TRIGGERS de atualizado_em (todas as tabelas que têm a coluna)
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_atual_turno            ON turno;
CREATE TRIGGER trg_atual_turno            BEFORE UPDATE ON turno            FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_produto          ON produto;
CREATE TRIGGER trg_atual_produto          BEFORE UPDATE ON produto          FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_maquina          ON maquina;
CREATE TRIGGER trg_atual_maquina          BEFORE UPDATE ON maquina          FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_operador         ON operador;
CREATE TRIGGER trg_atual_operador         BEFORE UPDATE ON operador         FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_motivo_parada    ON motivo_parada;
CREATE TRIGGER trg_atual_motivo_parada    BEFORE UPDATE ON motivo_parada    FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_catalogo_defeito ON catalogo_defeito;
CREATE TRIGGER trg_atual_catalogo_defeito BEFORE UPDATE ON catalogo_defeito FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_gatilho_rnc      ON gatilho_rnc;
CREATE TRIGGER trg_atual_gatilho_rnc      BEFORE UPDATE ON gatilho_rnc      FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_ordem_producao   ON ordem_producao;
CREATE TRIGGER trg_atual_ordem_producao   BEFORE UPDATE ON ordem_producao   FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_apontamento      ON apontamento;
CREATE TRIGGER trg_atual_apontamento      BEFORE UPDATE ON apontamento      FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_nao_conformidade ON nao_conformidade;
CREATE TRIGGER trg_atual_nao_conformidade BEFORE UPDATE ON nao_conformidade FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_stg_importacao   ON stg_importacao;
CREATE TRIGGER trg_atual_stg_importacao   BEFORE UPDATE ON stg_importacao   FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();


-- ════════════════════════════════════════════════════════════════════════════
-- ÍNDICES (nota 2): toda FK indexada + os 2 índices compostos das consultas quentes
-- ════════════════════════════════════════════════════════════════════════════
-- Consultas quentes (compostos cobrem também a FK líder):
CREATE INDEX IF NOT EXISTS idx_nc_defeito_datahora     ON nao_conformidade (defeito_id, datahora);       -- Pareto
CREATE INDEX IF NOT EXISTS idx_apont_maquina_inicio    ON apontamento      (maquina_id, datahora_inicio); -- OEE

-- Demais FKs:
CREATE INDEX IF NOT EXISTS idx_op_produto              ON ordem_producao   (produto_id);
CREATE INDEX IF NOT EXISTS idx_op_maquina_prevista     ON ordem_producao   (maquina_prevista_id);
CREATE INDEX IF NOT EXISTS idx_apont_op                ON apontamento      (op_id);
CREATE INDEX IF NOT EXISTS idx_apont_operador          ON apontamento      (operador_id);
CREATE INDEX IF NOT EXISTS idx_apont_turno             ON apontamento      (turno_id);
CREATE INDEX IF NOT EXISTS idx_parada_apontamento      ON parada           (apontamento_id);
CREATE INDEX IF NOT EXISTS idx_parada_motivo           ON parada           (motivo_id);
CREATE INDEX IF NOT EXISTS idx_nc_apontamento          ON nao_conformidade (apontamento_id);
CREATE INDEX IF NOT EXISTS idx_foto_nc                 ON foto             (nc_id);
CREATE INDEX IF NOT EXISTS idx_depara_defeito          ON de_para_defeito  (defeito_id);
CREATE INDEX IF NOT EXISTS idx_gatilho_defeito         ON gatilho_rnc      (defeito_id);
CREATE INDEX IF NOT EXISTS idx_stg_defeito             ON stg_importacao   (defeito_id);
CREATE INDEX IF NOT EXISTS idx_stg_lote                ON stg_importacao   (lote_id);


-- ════════════════════════════════════════════════════════════════════════════
-- Supabase: libera acesso via service_role (no-op em PostgreSQL puro)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE turno            DISABLE ROW LEVEL SECURITY;
ALTER TABLE produto          DISABLE ROW LEVEL SECURITY;
ALTER TABLE maquina          DISABLE ROW LEVEL SECURITY;
ALTER TABLE operador         DISABLE ROW LEVEL SECURITY;
ALTER TABLE motivo_parada    DISABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_defeito DISABLE ROW LEVEL SECURITY;
ALTER TABLE de_para_defeito  DISABLE ROW LEVEL SECURITY;
ALTER TABLE gatilho_rnc      DISABLE ROW LEVEL SECURITY;
ALTER TABLE ordem_producao   DISABLE ROW LEVEL SECURITY;
ALTER TABLE apontamento      DISABLE ROW LEVEL SECURITY;
ALTER TABLE parada           DISABLE ROW LEVEL SECURITY;
ALTER TABLE nao_conformidade DISABLE ROW LEVEL SECURITY;
ALTER TABLE foto             DISABLE ROW LEVEL SECURITY;
ALTER TABLE stg_importacao   DISABLE ROW LEVEL SECURITY;

-- ============================================================================
-- FIM — 14 tabelas. CEP/CNQ/OEE (fases 2 e 3) serão VIEWS sobre estas tabelas.
-- ============================================================================
