-- ============================================================================
-- MES MALHA FORTE — SCHEMA COMPLETO (ordem de migração)
-- Rode UMA VEZ num banco PostgreSQL 15+ novo para reproduzir todo o schema.
-- Gerado a partir de mes_migrations/. Idempotente.
-- ============================================================================

-- ╔══ mes_migrations/01_schema.sql ══╗
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

-- ╔══ mes_migrations/02_tpm.sql ══╗
-- ============================================================================
-- MES MALHA FORTE — Módulo TPM / Manutenção (fase 5)
-- 10 tabelas + 4 VIEWS (MTBF, MTTR, cumprimento do CIL, etiquetas abertas).
-- As VIEWS leem das tabelas existentes (parada, apontamento, motivo_parada,
-- nao_conformidade) sem duplicar dado. Idempotente.
-- Pré-requisito: mes_schema.sql já aplicado (maquina, operador, turno, parada).
-- ============================================================================

-- usa o trigger genérico já criado em mes_schema.sql: set_atualizado_em()

-- 1. componente — sub-ativos da máquina ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS componente (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id        UUID NOT NULL REFERENCES maquina(id),
    codigo            TEXT NOT NULL UNIQUE,
    nome              TEXT NOT NULL,
    tipo              TEXT NOT NULL CHECK (tipo IN ('desgaste','mecanico','eletrico','pneumatico','outro')),
    vida_util_valor   NUMERIC(12,2),
    vida_util_unidade TEXT CHECK (vida_util_unidade IN ('horas','kg','ciclos','dias')),
    ativo             BOOLEAN NOT NULL DEFAULT true,
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. plano_manutencao — preventiva e preditiva ────────────────────────────────
CREATE TABLE IF NOT EXISTS plano_manutencao (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id           UUID NOT NULL REFERENCES maquina(id),
    componente_id        UUID REFERENCES componente(id),
    nome                 TEXT NOT NULL,
    tipo                 TEXT NOT NULL CHECK (tipo IN ('preventiva','preditiva','lubrificacao','inspecao')),
    gatilho              TEXT NOT NULL CHECK (gatilho IN ('calendario','contador')),
    intervalo_valor      NUMERIC(12,2) NOT NULL,
    intervalo_unidade    TEXT NOT NULL CHECK (intervalo_unidade IN ('dias','horas','kg','ciclos')),
    instrucoes           TEXT,
    duracao_estimada_min INT,
    ativo                BOOLEAN NOT NULL DEFAULT true,
    criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. peca — sobressalentes (antes de ordem_manutencao p/ consumo_peca depois) ──
CREATE TABLE IF NOT EXISTS peca (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo          TEXT NOT NULL UNIQUE,
    nome            TEXT NOT NULL,
    categoria       TEXT,
    estoque_atual   NUMERIC(12,3) NOT NULL DEFAULT 0,
    estoque_minimo  NUMERIC(12,3) NOT NULL DEFAULT 0,
    unidade         TEXT NOT NULL CHECK (unidade IN ('un','kg','m','jogo')),
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. ordem_manutencao — OM (tempo_reparo_min é coluna gerada) ──────────────────
CREATE TABLE IF NOT EXISTS ordem_manutencao (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id       UUID NOT NULL REFERENCES maquina(id),
    componente_id    UUID REFERENCES componente(id),
    plano_id         UUID REFERENCES plano_manutencao(id),
    parada_id        UUID REFERENCES parada(id),       -- liga corretiva à quebra
    tipo             TEXT NOT NULL CHECK (tipo IN ('corretiva','preventiva','preditiva')),
    prioridade       TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta','urgente')),
    status           TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','planejada','em_execucao','concluida','cancelada')),
    descricao        TEXT NOT NULL,
    executor_id      UUID REFERENCES operador(id),
    aberta_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    iniciada_em      TIMESTAMPTZ,
    concluida_em     TIMESTAMPTZ,
    tempo_reparo_min INT GENERATED ALWAYS AS ((EXTRACT(EPOCH FROM (concluida_em - iniciada_em)) / 60)::int) STORED,
    causa            TEXT,
    acao_realizada   TEXT,
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. etiqueta_anomalia — TPM tag do operador ──────────────────────────────────
CREATE TABLE IF NOT EXISTS etiqueta_anomalia (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id          UUID NOT NULL REFERENCES maquina(id),
    componente_id       UUID REFERENCES componente(id),
    operador_id         UUID NOT NULL REFERENCES operador(id),
    tipo                TEXT NOT NULL CHECK (tipo IN ('seguranca','qualidade','quebra_iminente','lubrificacao','limpeza','outro')),
    gravidade           TEXT NOT NULL DEFAULT 'media' CHECK (gravidade IN ('baixa','media','alta')),
    descricao           TEXT NOT NULL,
    foto_url            TEXT,
    status              TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_tratativa','resolvida')),
    ordem_manutencao_id UUID REFERENCES ordem_manutencao(id),
    aberta_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolvida_em        TIMESTAMPTZ,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. checklist_autonoma — template do CIL ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_autonoma (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maquina_id    UUID REFERENCES maquina(id),          -- NULL = vale p/ um tipo
    tipo_maquina  TEXT CHECK (tipo_maquina IN ('circular','retilinea','tear','rama','tinturaria','revisao','outro')),
    nome          TEXT NOT NULL,
    frequencia    TEXT NOT NULL CHECK (frequencia IN ('turno','diaria','semanal')),
    ativo         BOOLEAN NOT NULL DEFAULT true,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. checklist_item — itens do CIL ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_item (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id UUID NOT NULL REFERENCES checklist_autonoma(id),
    ordem        INT NOT NULL,
    descricao    TEXT NOT NULL,
    tipo         TEXT NOT NULL CHECK (tipo IN ('limpeza','inspecao','lubrificacao')),
    referencia   TEXT,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. checklist_execucao — operador cumpre a rotina ────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_execucao (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checklist_id UUID NOT NULL REFERENCES checklist_autonoma(id),
    maquina_id   UUID NOT NULL REFERENCES maquina(id),
    operador_id  UUID NOT NULL REFERENCES operador(id),
    turno_id     UUID NOT NULL REFERENCES turno(id),
    executado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    status       TEXT NOT NULL CHECK (status IN ('completo','parcial')),
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. checklist_execucao_item — resultado item a item ──────────────────────────
CREATE TABLE IF NOT EXISTS checklist_execucao_item (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    execucao_id UUID NOT NULL REFERENCES checklist_execucao(id),
    item_id     UUID NOT NULL REFERENCES checklist_item(id),
    resultado   TEXT NOT NULL CHECK (resultado IN ('ok','nao_ok','nao_aplicavel')),
    observacao  TEXT,
    etiqueta_id UUID REFERENCES etiqueta_anomalia(id),
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. consumo_peca — peças usadas numa OM ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS consumo_peca (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ordem_manutencao_id UUID NOT NULL REFERENCES ordem_manutencao(id),
    peca_id             UUID NOT NULL REFERENCES peca(id),
    quantidade          NUMERIC(12,3) NOT NULL CHECK (quantidade > 0),
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Triggers de atualizado_em ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_atual_componente        ON componente;
CREATE TRIGGER trg_atual_componente        BEFORE UPDATE ON componente        FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_plano_manut       ON plano_manutencao;
CREATE TRIGGER trg_atual_plano_manut       BEFORE UPDATE ON plano_manutencao   FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_peca              ON peca;
CREATE TRIGGER trg_atual_peca              BEFORE UPDATE ON peca               FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_ordem_manut       ON ordem_manutencao;
CREATE TRIGGER trg_atual_ordem_manut       BEFORE UPDATE ON ordem_manutencao   FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_etiqueta          ON etiqueta_anomalia;
CREATE TRIGGER trg_atual_etiqueta          BEFORE UPDATE ON etiqueta_anomalia  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
DROP TRIGGER IF EXISTS trg_atual_checklist_auto    ON checklist_autonoma;
CREATE TRIGGER trg_atual_checklist_auto    BEFORE UPDATE ON checklist_autonoma FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- ── Índices (FKs) ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_componente_maquina   ON componente            (maquina_id);
CREATE INDEX IF NOT EXISTS idx_plano_maquina        ON plano_manutencao      (maquina_id);
CREATE INDEX IF NOT EXISTS idx_plano_componente     ON plano_manutencao      (componente_id);
CREATE INDEX IF NOT EXISTS idx_om_maquina           ON ordem_manutencao      (maquina_id);
CREATE INDEX IF NOT EXISTS idx_om_componente        ON ordem_manutencao      (componente_id);
CREATE INDEX IF NOT EXISTS idx_om_plano             ON ordem_manutencao      (plano_id);
CREATE INDEX IF NOT EXISTS idx_om_parada            ON ordem_manutencao      (parada_id);
CREATE INDEX IF NOT EXISTS idx_om_executor          ON ordem_manutencao      (executor_id);
CREATE INDEX IF NOT EXISTS idx_etiq_maquina         ON etiqueta_anomalia     (maquina_id);
CREATE INDEX IF NOT EXISTS idx_etiq_componente      ON etiqueta_anomalia     (componente_id);
CREATE INDEX IF NOT EXISTS idx_etiq_operador        ON etiqueta_anomalia     (operador_id);
CREATE INDEX IF NOT EXISTS idx_etiq_om              ON etiqueta_anomalia     (ordem_manutencao_id);
CREATE INDEX IF NOT EXISTS idx_clitem_checklist     ON checklist_item        (checklist_id);
CREATE INDEX IF NOT EXISTS idx_clexec_checklist     ON checklist_execucao    (checklist_id);
CREATE INDEX IF NOT EXISTS idx_clexec_maquina       ON checklist_execucao    (maquina_id);
CREATE INDEX IF NOT EXISTS idx_clexec_operador      ON checklist_execucao    (operador_id);
CREATE INDEX IF NOT EXISTS idx_clexec_turno         ON checklist_execucao    (turno_id);
CREATE INDEX IF NOT EXISTS idx_clexecitem_exec      ON checklist_execucao_item (execucao_id);
CREATE INDEX IF NOT EXISTS idx_clexecitem_item      ON checklist_execucao_item (item_id);
CREATE INDEX IF NOT EXISTS idx_clexecitem_etiq      ON checklist_execucao_item (etiqueta_id);
CREATE INDEX IF NOT EXISTS idx_consumo_om           ON consumo_peca          (ordem_manutencao_id);
CREATE INDEX IF NOT EXISTS idx_consumo_peca         ON consumo_peca          (peca_id);

-- ── DISABLE RLS (Supabase; no-op em Postgres puro) ────────────────────────────
ALTER TABLE componente              DISABLE ROW LEVEL SECURITY;
ALTER TABLE plano_manutencao        DISABLE ROW LEVEL SECURITY;
ALTER TABLE peca                    DISABLE ROW LEVEL SECURITY;
ALTER TABLE ordem_manutencao        DISABLE ROW LEVEL SECURITY;
ALTER TABLE etiqueta_anomalia       DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_autonoma      DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_item          DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_execucao      DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_execucao_item DISABLE ROW LEVEL SECURITY;
ALTER TABLE consumo_peca            DISABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════════════════
-- VIEWS (indicadores) — leem das tabelas existentes, NÃO duplicam dado
-- ════════════════════════════════════════════════════════════════════════════

-- MTTR: média do tempo de reparo das corretivas, por máquina
CREATE OR REPLACE VIEW vw_mttr AS
SELECT maquina_id,
       COUNT(*)                       AS corretivas,
       ROUND(AVG(tempo_reparo_min))   AS mttr_min
FROM ordem_manutencao
WHERE tipo = 'corretiva' AND tempo_reparo_min IS NOT NULL
GROUP BY maquina_id;

-- MTBF: horas produtivas ÷ nº de quebras (paradas de manutenção), por máquina
CREATE OR REPLACE VIEW vw_mtbf AS
WITH prod AS (
    SELECT maquina_id,
           SUM(EXTRACT(EPOCH FROM (COALESCE(datahora_fim, now()) - datahora_inicio)) / 3600.0) AS horas_op
    FROM apontamento GROUP BY maquina_id
), quebras AS (
    SELECT a.maquina_id, COUNT(*) AS n
    FROM parada p
    JOIN apontamento a   ON a.id = p.apontamento_id
    JOIN motivo_parada m ON m.id = p.motivo_id
    WHERE m.categoria = 'manutencao'
    GROUP BY a.maquina_id
)
SELECT pr.maquina_id,
       ROUND(pr.horas_op::numeric, 1)                          AS horas_operadas,
       COALESCE(q.n, 0)                                        AS quebras,
       CASE WHEN COALESCE(q.n, 0) > 0
            THEN ROUND((pr.horas_op / q.n)::numeric, 1) END    AS mtbf_horas
FROM prod pr LEFT JOIN quebras q ON q.maquina_id = pr.maquina_id;

-- Cumprimento do CIL: execuções 'completo' ÷ total, por máquina
CREATE OR REPLACE VIEW vw_cil_cumprimento AS
SELECT maquina_id,
       COUNT(*) FILTER (WHERE status = 'completo') AS completas,
       COUNT(*)                                    AS execucoes,
       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'completo') / NULLIF(COUNT(*), 0), 1) AS pct_cumprimento
FROM checklist_execucao
GROUP BY maquina_id;

-- Etiquetas abertas e idade média, por máquina
CREATE OR REPLACE VIEW vw_etiquetas_abertas AS
SELECT maquina_id,
       COUNT(*)                                                              AS abertas,
       ROUND(AVG(EXTRACT(EPOCH FROM (now() - aberta_em)) / 86400.0)::numeric, 1) AS idade_media_dias
FROM etiqueta_anomalia
WHERE status <> 'resolvida'
GROUP BY maquina_id;

-- ============================================================================
-- FIM — 10 tabelas + 4 views. Sem telas (fase 5 é schema + indicadores).
-- ============================================================================

-- ╔══ mes_migrations/03_indicadores.sql ══╗
-- ============================================================================
-- MES MALHA FORTE — Indicadores (fases 2 e 3) como VIEWS
-- OEE, Pareto de defeitos e resumo de qualidade. Tudo lê das tabelas de
-- apontamento/parada/nao_conformidade — NÃO duplica dado. Idempotente.
-- ============================================================================

-- ── OEE por máquina (Disponibilidade × Performance × Qualidade) ───────────────
-- Disponibilidade = (tempo de sessão − paradas que contam OEE) / tempo de sessão
-- Qualidade       = qtd_boa / (qtd_boa + refugo + retrabalho)
-- Performance     = produção real / (capacidade_nominal kg/h × horas operando)
CREATE OR REPLACE VIEW vw_oee AS
WITH base AS (
    SELECT a.maquina_id,
           SUM(EXTRACT(EPOCH FROM (COALESCE(a.datahora_fim, now()) - a.datahora_inicio))) AS seg_sessao,
           SUM(a.qtd_boa)                                       AS boa,
           SUM(a.qtd_boa + a.qtd_refugo + a.qtd_retrabalho)     AS total_prod
    FROM apontamento a
    GROUP BY a.maquina_id
),
par AS (
    SELECT a.maquina_id, SUM(COALESCE(p.duracao_segundos, 0)) AS seg_parada
    FROM parada p
    JOIN apontamento a   ON a.id = p.apontamento_id
    JOIN motivo_parada m ON m.id = p.motivo_id
    WHERE m.conta_oee = true
    GROUP BY a.maquina_id
)
SELECT b.maquina_id,
       mq.codigo AS maquina_codigo,
       mq.nome   AS maquina_nome,
       ROUND((b.seg_sessao / 3600.0)::numeric, 1)                                       AS horas_sessao,
       d.disponibilidade,
       q.qualidade,
       p.performance,
       CASE WHEN d.disponibilidade IS NOT NULL AND p.performance IS NOT NULL AND q.qualidade IS NOT NULL
            THEN ROUND((d.disponibilidade * p.performance * q.qualidade / 10000.0)::numeric, 1) END AS oee
FROM base b
JOIN maquina mq ON mq.id = b.maquina_id
LEFT JOIN par ON par.maquina_id = b.maquina_id
CROSS JOIN LATERAL (
    SELECT CASE WHEN b.seg_sessao > 0
                THEN ROUND(((b.seg_sessao - COALESCE(par.seg_parada, 0)) / b.seg_sessao * 100)::numeric, 1) END AS disponibilidade
) d
CROSS JOIN LATERAL (
    SELECT CASE WHEN b.total_prod > 0
                THEN ROUND((b.boa / b.total_prod * 100)::numeric, 1) END AS qualidade
) q
CROSS JOIN LATERAL (
    SELECT CASE WHEN mq.capacidade_nominal > 0 AND (b.seg_sessao - COALESCE(par.seg_parada, 0)) > 0
                THEN LEAST(ROUND((b.total_prod / (mq.capacidade_nominal * ((b.seg_sessao - COALESCE(par.seg_parada, 0)) / 3600.0)) * 100)::numeric, 1), 999) END AS performance
) p;

-- ── Pareto de defeitos (ocorrências + qtd afetada + % acumulado) ──────────────
CREATE OR REPLACE VIEW vw_pareto_defeito AS
WITH agg AS (
    SELECT d.id   AS defeito_id, d.codigo, d.descricao, d.categoria,
           COUNT(*)             AS ocorrencias,
           SUM(nc.qtd_afetada)  AS qtd_afetada
    FROM nao_conformidade nc
    JOIN catalogo_defeito d ON d.id = nc.defeito_id
    GROUP BY d.id, d.codigo, d.descricao, d.categoria
),
tot AS (SELECT NULLIF(SUM(ocorrencias), 0) AS t FROM agg)
SELECT a.defeito_id, a.codigo, a.descricao, a.categoria, a.ocorrencias, a.qtd_afetada,
       ROUND(100.0 * a.ocorrencias / (SELECT t FROM tot), 1)                                   AS pct,
       ROUND(100.0 * SUM(a.ocorrencias) OVER (ORDER BY a.ocorrencias DESC, a.codigo) / (SELECT t FROM tot), 1) AS pct_acumulado
FROM agg a
ORDER BY a.ocorrencias DESC, a.codigo;

-- ── Resumo de qualidade / CNQ (proxy por disposição enquanto custo é fase 3) ──
CREATE OR REPLACE VIEW vw_qualidade_resumo AS
SELECT
    COUNT(*)                                                       AS total_ncs,
    COALESCE(SUM(qtd_afetada), 0)                                  AS qtd_total_afetada,
    COALESCE(SUM(qtd_afetada) FILTER (WHERE disposicao = 'refugar'), 0)       AS qtd_refugada,
    COALESCE(SUM(qtd_afetada) FILTER (WHERE disposicao = 'retrabalhar'), 0)   AS qtd_retrabalho,
    COALESCE(SUM(qtd_afetada) FILTER (WHERE disposicao = 'segregar'), 0)      AS qtd_segregada,
    COALESCE(SUM(qtd_afetada) FILTER (WHERE disposicao = 'reclassificar'), 0) AS qtd_reclassificada,
    COUNT(*) FILTER (WHERE gera_rnc)                               AS rncs_geradas,
    COUNT(*) FILTER (WHERE severidade_aplicada = 4)                AS criticas
FROM nao_conformidade;

-- ── Qualidade por categoria de defeito (para o donut/quebra) ──────────────────
CREATE OR REPLACE VIEW vw_qualidade_categoria AS
SELECT d.categoria,
       COUNT(*)            AS ocorrencias,
       SUM(nc.qtd_afetada) AS qtd_afetada
FROM nao_conformidade nc
JOIN catalogo_defeito d ON d.id = nc.defeito_id
GROUP BY d.categoria
ORDER BY ocorrencias DESC;

-- ============================================================================
-- FIM — 4 views de indicadores. Leem das tabelas de captura, sem duplicar dado.
-- ============================================================================

-- ╔══ mes_migrations/04_cnq.sql ══╗
-- ============================================================================
-- MES MALHA FORTE — CNQ (Custo da Não Qualidade) — fecha a fase 3
-- Custo de cada NC = qtd_afetada × custo_unitario_do_produto × fator(disposição).
-- Tudo é VIEW sobre nao_conformidade/apontamento/ordem_producao/produto.
-- Idempotente.
-- ============================================================================

-- custo unitário do produto (R$ por unidade_medida). Editável na tela de CNQ.
ALTER TABLE produto ADD COLUMN IF NOT EXISTS custo_unitario NUMERIC(14,4) NOT NULL DEFAULT 0;

-- Custo por NC (on-the-fly, sempre reflete o custo atual do produto)
-- Fatores de perda por disposição:
--   refugar 1.0 (perda total) · segregar 0.5 · reclassificar 0.3 · retrabalhar 0.25 · liberar 0
CREATE OR REPLACE VIEW vw_cnq AS
SELECT nc.id AS nc_id, nc.defeito_id, nc.disposicao, nc.qtd_afetada, nc.datahora,
       p.id AS produto_id, p.custo_unitario,
       (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
            WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END) AS fator,
       ROUND((nc.qtd_afetada * p.custo_unitario *
            (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
                 WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END))::numeric, 2) AS custo
FROM nao_conformidade nc
JOIN apontamento     a  ON a.id  = nc.apontamento_id
JOIN ordem_producao  op ON op.id = a.op_id
JOIN produto         p  ON p.id  = op.produto_id;

-- Resumo do CNQ (cards do painel)
CREATE OR REPLACE VIEW vw_cnq_resumo AS
SELECT COALESCE(SUM(custo), 0)                                          AS custo_total,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'refugar'), 0)    AS custo_refugo,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'retrabalhar'), 0) AS custo_retrabalho,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'segregar'), 0)   AS custo_segregado,
       COALESCE(SUM(custo) FILTER (WHERE disposicao = 'reclassificar'), 0) AS custo_reclassificado,
       COUNT(*) FILTER (WHERE custo > 0)                                AS ncs_com_custo,
       COUNT(*) FILTER (WHERE custo = 0 AND custo_unitario = 0)         AS ncs_sem_custo_produto
FROM vw_cnq;

-- CNQ por defeito (Pareto de CUSTO — onde o dinheiro está vazando)
CREATE OR REPLACE VIEW vw_cnq_defeito AS
SELECT c.defeito_id, d.codigo, d.descricao, d.categoria,
       ROUND(SUM(c.custo)::numeric, 2) AS custo, COUNT(*) AS ocorrencias
FROM vw_cnq c JOIN catalogo_defeito d ON d.id = c.defeito_id
GROUP BY c.defeito_id, d.codigo, d.descricao, d.categoria
HAVING SUM(c.custo) > 0
ORDER BY custo DESC;

-- ============================================================================
-- FIM — coluna custo_unitario + 3 views de CNQ. Backfill de custo_estimado é
-- feito pelo endpoint /api/mf/cnq/recalcular (congela o custo na NC).
-- ============================================================================

-- ╔══ mes_migrations/05_qualidade_v2.sql ══╗
-- ============================================================================
-- MES MALHA FORTE — Qualidade v2: CNQ por etapa + Scorecard de Fornecedor
-- (Onda 1 das melhorias). Substitui vw_cnq e adiciona vw_fornecedor. Idempotente.
-- ============================================================================

-- CNQ por ETAPA: defeito gerado/pego mais adiante na cadeia acumulou mais custo.
-- fator_etapa: malharia 1.0 · tinturaria 1.5 · acabamento 2.0 · revisao 2.5
CREATE OR REPLACE VIEW vw_cnq AS
SELECT nc.id AS nc_id, nc.defeito_id, nc.disposicao, nc.qtd_afetada, nc.datahora,
       d.etapa, p.id AS produto_id, p.custo_unitario,
       (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
            WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END) AS fator_disposicao,
       (CASE d.etapa WHEN 'malharia' THEN 1.0 WHEN 'tinturaria' THEN 1.5
            WHEN 'acabamento' THEN 2.0 WHEN 'revisao' THEN 2.5 ELSE 1.0 END) AS fator_etapa,
       ROUND((nc.qtd_afetada * p.custo_unitario
            * (CASE nc.disposicao WHEN 'refugar' THEN 1.0 WHEN 'segregar' THEN 0.5
                   WHEN 'reclassificar' THEN 0.3 WHEN 'retrabalhar' THEN 0.25 ELSE 0.0 END)
            * (CASE d.etapa WHEN 'malharia' THEN 1.0 WHEN 'tinturaria' THEN 1.5
                   WHEN 'acabamento' THEN 2.0 WHEN 'revisao' THEN 2.5 ELSE 1.0 END))::numeric, 2) AS custo
FROM nao_conformidade nc
JOIN catalogo_defeito d  ON d.id  = nc.defeito_id
JOIN apontamento      a  ON a.id  = nc.apontamento_id
JOIN ordem_producao   op ON op.id = a.op_id
JOIN produto          p  ON p.id  = op.produto_id;

-- Scorecard de fornecedor: cruza lote de fio → sessões → NCs e custo CNQ.
-- Responde: "qual fornecedor de fio gera mais defeito e custo?"
CREATE OR REPLACE VIEW vw_fornecedor AS
WITH ap_forn AS (
    SELECT DISTINCT lf.fornecedor, cf.apontamento_id
    FROM consumo_fio cf JOIN lote_fio lf ON lf.id = cf.lote_fio_id
    WHERE lf.fornecedor IS NOT NULL
),
kg AS (
    SELECT lf.fornecedor, SUM(cf.qtd_consumida_kg) AS kg
    FROM consumo_fio cf JOIN lote_fio lf ON lf.id = cf.lote_fio_id
    WHERE lf.fornecedor IS NOT NULL GROUP BY lf.fornecedor
)
SELECT af.fornecedor,
       COUNT(DISTINCT af.apontamento_id)                                              AS sessoes,
       ROUND(MAX(kg.kg)::numeric, 1)                                                  AS kg_consumido,
       COALESCE(SUM((SELECT COUNT(*) FROM nao_conformidade nc WHERE nc.apontamento_id = af.apontamento_id)), 0) AS ncs,
       ROUND(COALESCE(SUM((SELECT COALESCE(SUM(v.custo), 0) FROM vw_cnq v
              JOIN nao_conformidade nc ON nc.id = v.nc_id
              WHERE nc.apontamento_id = af.apontamento_id)), 0)::numeric, 2)          AS custo_cnq
FROM ap_forn af LEFT JOIN kg ON kg.fornecedor = af.fornecedor
GROUP BY af.fornecedor
ORDER BY ncs DESC, custo_cnq DESC;

-- ============================================================================
-- FIM — vw_cnq agora multiplica por etapa; vw_fornecedor é o scorecard.
-- vw_cnq_resumo e vw_cnq_defeito herdam o novo custo automaticamente.
-- ============================================================================

-- ╔══ mes_migrations/06_rastreabilidade.sql ══╗
-- ============================================================================
-- MES MALHA FORTE — Rastreabilidade (fase 4): genealogia do lote, do fio à peça
-- lote_fio (matéria-prima) → consumo_fio (numa sessão de apontamento) → produção.
-- Permite "recall": dado um lote de fio ruim, achar tudo que ele afetou.
-- Idempotente. Pré-requisito: mes_schema.sql (apontamento, etc).
-- ============================================================================

-- 1. lote_fio — lote de matéria-prima (fio) recebido
CREATE TABLE IF NOT EXISTS lote_fio (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo              TEXT NOT NULL UNIQUE,        -- nº do lote do fornecedor
    fornecedor          TEXT,
    composicao          TEXT,                         -- ex: PV 67/33
    titulo_fio          TEXT,                         -- ex: 30/1
    cor                 TEXT,
    qtd_recebida_kg     NUMERIC(14,3) NOT NULL DEFAULT 0,
    qtd_disponivel_kg   NUMERIC(14,3) NOT NULL DEFAULT 0,  -- baixa conforme consumo
    data_recebimento    TIMESTAMPTZ,
    ativo               BOOLEAN NOT NULL DEFAULT true,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. consumo_fio — qual lote de fio foi consumido em qual sessão de apontamento
CREATE TABLE IF NOT EXISTS consumo_fio (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apontamento_id   UUID NOT NULL REFERENCES apontamento(id),
    lote_fio_id      UUID NOT NULL REFERENCES lote_fio(id),
    qtd_consumida_kg NUMERIC(14,3) NOT NULL CHECK (qtd_consumida_kg > 0),
    criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_atual_lote_fio ON lote_fio;
CREATE TRIGGER trg_atual_lote_fio BEFORE UPDATE ON lote_fio FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE INDEX IF NOT EXISTS idx_consumo_fio_apont ON consumo_fio (apontamento_id);
CREATE INDEX IF NOT EXISTS idx_consumo_fio_lote  ON consumo_fio (lote_fio_id);

ALTER TABLE lote_fio    DISABLE ROW LEVEL SECURITY;
ALTER TABLE consumo_fio DISABLE ROW LEVEL SECURITY;

-- ── VIEW de genealogia: liga lote de fio → produção → não conformidade ────────
-- Cada linha é um consumo de fio com toda a cadeia até a peça e os defeitos.
CREATE OR REPLACE VIEW vw_genealogia AS
SELECT cf.id                AS consumo_id,
       lf.id                AS lote_fio_id,
       lf.codigo            AS lote_fio_codigo,
       lf.fornecedor,
       cf.qtd_consumida_kg,
       a.id                 AS apontamento_id,
       a.datahora_inicio,
       op.id                AS op_id,
       op.numero            AS op_numero,
       p.codigo             AS produto_codigo,
       p.descricao          AS produto_descricao,
       a.maquina_id,
       mq.codigo            AS maquina_codigo,
       (SELECT COUNT(*) FROM nao_conformidade nc WHERE nc.apontamento_id = a.id) AS ncs_na_sessao
FROM consumo_fio cf
JOIN lote_fio        lf ON lf.id = cf.lote_fio_id
JOIN apontamento     a  ON a.id  = cf.apontamento_id
JOIN ordem_producao  op ON op.id = a.op_id
JOIN produto         p  ON p.id  = op.produto_id
JOIN maquina         mq ON mq.id = a.maquina_id;

-- ============================================================================
-- FIM — 2 tabelas + 1 view de genealogia (recall do fio à peça).
-- ============================================================================

-- ╔══ mes_migrations/07_rnc.sql ══╗
-- ============================================================================
-- MES MALHA FORTE — RNC / CAPA (loop de ação corretiva) — Onda 2
-- Quando uma NC dispara gatilho (gera_rnc), abre-se uma RNC formal que percorre:
-- aberta → em_analise (causa raiz) → em_acao (ação corretiva) → verificacao
-- (eficácia) → fechada. É o que transforma "medir" em "melhorar". Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rnc (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nc_id               UUID REFERENCES nao_conformidade(id),  -- NC que originou (NULL = aberta manual)
    defeito_id          UUID REFERENCES catalogo_defeito(id),
    maquina_id          UUID REFERENCES maquina(id),
    titulo              TEXT NOT NULL,
    descricao           TEXT,
    prioridade          TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta','critica')),
    status              TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_analise','em_acao','verificacao','fechada','cancelada')),
    responsavel_id      UUID REFERENCES operador(id),
    prazo               TIMESTAMPTZ,
    -- análise de causa raiz
    causa_raiz          TEXT,
    metodo_analise      TEXT CHECK (metodo_analise IN ('cinco_porques','ishikawa','outro')),
    -- ação corretiva
    acao_corretiva      TEXT,
    acao_concluida_em   TIMESTAMPTZ,
    -- verificação de eficácia
    eficaz              BOOLEAN,
    verificacao_obs     TEXT,
    aberta_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    fechada_em          TIMESTAMPTZ,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_atual_rnc ON rnc;
CREATE TRIGGER trg_atual_rnc BEFORE UPDATE ON rnc FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE INDEX IF NOT EXISTS idx_rnc_nc        ON rnc (nc_id);
CREATE INDEX IF NOT EXISTS idx_rnc_status    ON rnc (status);
CREATE INDEX IF NOT EXISTS idx_rnc_defeito   ON rnc (defeito_id);
CREATE INDEX IF NOT EXISTS idx_rnc_responsav ON rnc (responsavel_id);
ALTER TABLE rnc DISABLE ROW LEVEL SECURITY;

-- Resumo do quadro CAPA (cards + atrasadas)
CREATE OR REPLACE VIEW vw_rnc_resumo AS
SELECT COUNT(*) FILTER (WHERE status NOT IN ('fechada','cancelada'))                          AS abertas,
       COUNT(*) FILTER (WHERE status = 'em_analise')                                          AS em_analise,
       COUNT(*) FILTER (WHERE status = 'em_acao')                                             AS em_acao,
       COUNT(*) FILTER (WHERE status = 'verificacao')                                         AS verificacao,
       COUNT(*) FILTER (WHERE status = 'fechada')                                             AS fechadas,
       COUNT(*) FILTER (WHERE status NOT IN ('fechada','cancelada') AND prazo IS NOT NULL AND prazo < now()) AS atrasadas,
       COUNT(*) FILTER (WHERE status = 'fechada' AND eficaz = true)                           AS fechadas_eficazes
FROM rnc;

-- ============================================================================
-- FIM — tabela rnc + view de resumo. Backfill: o POST /api/mf/ncs abre uma RNC
-- automaticamente quando gera_rnc = true.
-- ============================================================================

-- ╔══ mes_migrations/08_cep.sql ══╗
-- ============================================================================
-- MES MALHA FORTE — CEP (Controle Estatístico de Processo) — Onda 3
-- Mede gramatura/largura reais vs. alvo, com cartas de controle (média ± 3σ)
-- e capabilidade Cp/Cpk. Idempotente. Pré-requisito: produto, apontamento.
-- ============================================================================

-- tolerância (±) do produto para definir os limites de especificação (LSL/USL)
ALTER TABLE produto ADD COLUMN IF NOT EXISTS gramatura_tol NUMERIC(8,2);  -- ± g/m²
ALTER TABLE produto ADD COLUMN IF NOT EXISTS largura_tol   NUMERIC(8,2);  -- ± cm

-- medição de variável no chão de fábrica
CREATE TABLE IF NOT EXISTS medicao (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    apontamento_id  UUID REFERENCES apontamento(id),
    produto_id      UUID NOT NULL REFERENCES produto(id),
    tipo            TEXT NOT NULL CHECK (tipo IN ('gramatura','largura')),
    valor           NUMERIC(12,3) NOT NULL,
    operador_id     UUID REFERENCES operador(id),
    datahora        TIMESTAMPTZ NOT NULL DEFAULT now(),
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_medicao_prod_tipo ON medicao (produto_id, tipo, datahora);
CREATE INDEX IF NOT EXISTS idx_medicao_apont     ON medicao (apontamento_id);
ALTER TABLE medicao DISABLE ROW LEVEL SECURITY;

-- Capabilidade do processo por produto+tipo:
--   LSL = alvo − tol · USL = alvo + tol
--   Cp  = (USL−LSL) / (6σ)             → potencial (largura da variação)
--   Cpk = min(USL−média, média−LSL) / (3σ) → real (inclui centragem)
-- Referência: Cpk ≥ 1.33 capaz · 1.00–1.33 marginal · < 1.00 incapaz
CREATE OR REPLACE VIEW vw_cep_capabilidade AS
WITH m AS (
    SELECT med.produto_id, med.tipo,
           AVG(med.valor)         AS media,
           STDDEV_SAMP(med.valor) AS sigma,
           COUNT(*)               AS n,
           MIN(med.valor)         AS minimo,
           MAX(med.valor)         AS maximo
    FROM medicao med
    GROUP BY med.produto_id, med.tipo
)
SELECT m.produto_id, p.codigo AS produto_codigo, p.descricao AS produto_descricao, m.tipo, m.n,
       ROUND(m.media::numeric, 2)  AS media,
       ROUND(m.sigma::numeric, 3)  AS sigma,
       ROUND(m.minimo::numeric, 2) AS minimo, ROUND(m.maximo::numeric, 2) AS maximo,
       (CASE m.tipo WHEN 'gramatura' THEN p.gramatura_alvo ELSE p.largura_alvo END) AS alvo,
       (CASE m.tipo WHEN 'gramatura' THEN p.gramatura_tol  ELSE p.largura_tol  END) AS tol,
       -- limites de controle (carta de individuais): média ± 3σ
       ROUND((m.media + 3 * m.sigma)::numeric, 2) AS ucl,
       ROUND((m.media - 3 * m.sigma)::numeric, 2) AS lcl,
       -- Cp e Cpk (só quando há alvo, tolerância e σ > 0)
       CASE WHEN m.sigma > 0 AND (CASE m.tipo WHEN 'gramatura' THEN p.gramatura_tol ELSE p.largura_tol END) > 0
            THEN ROUND(((CASE m.tipo WHEN 'gramatura' THEN p.gramatura_tol ELSE p.largura_tol END)
                        / (3 * m.sigma))::numeric, 2) END AS cp,
       CASE WHEN m.sigma > 0 AND (CASE m.tipo WHEN 'gramatura' THEN p.gramatura_alvo ELSE p.largura_alvo END) IS NOT NULL
                            AND (CASE m.tipo WHEN 'gramatura' THEN p.gramatura_tol  ELSE p.largura_tol  END) > 0
            THEN ROUND((LEAST(
                    ((CASE m.tipo WHEN 'gramatura' THEN p.gramatura_alvo ELSE p.largura_alvo END)
                     + (CASE m.tipo WHEN 'gramatura' THEN p.gramatura_tol ELSE p.largura_tol END) - m.media),
                    (m.media - ((CASE m.tipo WHEN 'gramatura' THEN p.gramatura_alvo ELSE p.largura_alvo END)
                     - (CASE m.tipo WHEN 'gramatura' THEN p.gramatura_tol ELSE p.largura_tol END)))
                 ) / (3 * m.sigma))::numeric, 2) END AS cpk
FROM m JOIN produto p ON p.id = m.produto_id;

-- ============================================================================
-- FIM — tabela medicao + colunas de tolerância + view de capabilidade.
-- As cartas de controle (pontos vs UCL/LCL/alvo) são montadas no front a partir
-- das medições + os limites desta view.
-- ============================================================================

-- ╔══ mes_migrations/09_metas.sql ══╗
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

