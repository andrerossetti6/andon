-- ============================================================
-- SIN1 • Gestão Stoll — Schema completo do Banco de Dados
-- Execute no Supabase: SQL Editor → New Query → Run
-- OU acesse http://localhost:3000/setup para diagnóstico
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Usuários ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil     TEXT DEFAULT 'viewer' CHECK (perfil IN ('admin', 'viewer')),
  ativo      BOOLEAN DEFAULT true,
  criado_em  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Vendas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS importacoes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  anos         TEXT[] DEFAULT '{}',
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes(id) ON DELETE CASCADE,
  codigo        TEXT,
  descricao     TEXT,
  modelo        TEXT,
  segmento      TEXT,
  tamanho       TEXT,
  marca         TEXT,
  meses         JSONB DEFAULT '{}',
  quantidade    NUMERIC(14,2) DEFAULT 0,
  valor         NUMERIC(14,2) DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vendas_importacao ON vendas(importacao_id);
CREATE INDEX IF NOT EXISTS idx_vendas_meses      ON vendas USING gin(meses);
CREATE INDEX IF NOT EXISTS idx_imp_criado        ON importacoes(criado_em DESC);

-- ── Estoque ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS importacoes_estoque (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estoque (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes_estoque(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,
  quantidade    NUMERIC(14,2) DEFAULT 0,
  dados         JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_estoque_importacao ON estoque(importacao_id);
CREATE INDEX IF NOT EXISTS idx_estoque_codigo     ON estoque(codigo);

-- ── Ordens de Produção ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS importacoes_op (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dados_op (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes_op(id) ON DELETE CASCADE,
  dados         JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dados_op_imp ON dados_op(importacao_id);

-- ── Costura ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS importacoes_costura (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dados_costura (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes_costura(id) ON DELETE CASCADE,
  dados         JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dados_costura_imp ON dados_costura(importacao_id);

-- ── Cliente ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS importacoes_cliente (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dados_cliente (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes_cliente(id) ON DELETE CASCADE,
  dados         JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dados_cliente_imp ON dados_cliente(importacao_id);

-- ── Banco de Dados ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS importacoes_banco (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dados_banco (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes_banco(id) ON DELETE CASCADE,
  dados         JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dados_banco_imp ON dados_banco(importacao_id);

-- ── Calendário ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS importacoes_calendario (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dados_calendario (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes_calendario(id) ON DELETE CASCADE,
  dados         JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dados_calendario_imp ON dados_calendario(importacao_id);

-- ── Capacidade (Matriz de Set Up) ────────────────────────────
CREATE TABLE IF NOT EXISTS importacoes_capacidade (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dados_capacidade (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes_capacidade(id) ON DELETE CASCADE,
  dados         JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_dados_capacidade_imp ON dados_capacidade(importacao_id);

-- ── Feriados e Turnos ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feriados (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data      DATE NOT NULL,
  nome      TEXT NOT NULL,
  tipo      TEXT DEFAULT 'nacional',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS turnos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome      TEXT NOT NULL,
  inicio    TIME,
  fim       TIME,
  dias      TEXT[] DEFAULT '{}',
  processo  TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

-- ── Processos e Máquinas ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS processos_config (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome      TEXT NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maquinas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id  UUID REFERENCES processos_config(id) ON DELETE CASCADE,
  id_maquina   TEXT,
  modelo       TEXT,
  oee          NUMERIC(5,2),
  status       TEXT,
  n_pessoas    INTEGER,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Usuário admin inicial ────────────────────────────────────
-- Senha padrão: Admin@2025  (altere após o primeiro login)
INSERT INTO usuarios (nome, email, senha_hash, perfil)
VALUES (
  'Administrador',
  'admin@stoll.com.br',
  '$2b$10$2bMWl.3YiKuiBFYO9n6EWe4PLp1gXZB5bltx28aLKKs3JtkI2VBAe',
  'admin'
) ON CONFLICT (email) DO NOTHING;
