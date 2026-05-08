-- ============================================================
-- SIGS • Gestão Stoll — Schema do Banco de Dados
-- Execute este arquivo no Supabase: SQL Editor → New Query
-- ============================================================

-- Extensão para gerar UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABELA: usuarios
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  perfil     TEXT DEFAULT 'viewer' CHECK (perfil IN ('admin', 'viewer')),
  ativo      BOOLEAN DEFAULT true,
  criado_em  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: importacoes
-- ============================================================
CREATE TABLE IF NOT EXISTS importacoes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  anos         TEXT[] DEFAULT '{}',
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: vendas
-- Meses armazenados como JSONB flexível: { "jan_2025": 150, "fev_2026": 80 }
-- ============================================================
CREATE TABLE IF NOT EXISTS vendas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes(id) ON DELETE CASCADE,
  codigo        TEXT,
  descricao     TEXT,
  modelo        TEXT,
  segmento      TEXT,
  tamanho       TEXT,
  meses         JSONB DEFAULT '{}',
  quantidade    NUMERIC(14,2) DEFAULT 0,
  valor         NUMERIC(14,2) DEFAULT 0
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_vendas_importacao ON vendas(importacao_id);
CREATE INDEX IF NOT EXISTS idx_vendas_segmento   ON vendas(segmento);
CREATE INDEX IF NOT EXISTS idx_vendas_meses      ON vendas USING gin(meses);
CREATE INDEX IF NOT EXISTS idx_imp_criado        ON importacoes(criado_em DESC);

-- ============================================================
-- TABELA: importacoes_estoque
-- ============================================================
CREATE TABLE IF NOT EXISTS importacoes_estoque (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo TEXT NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  total_linhas INTEGER DEFAULT 0,
  criado_em    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABELA: estoque
-- ============================================================
CREATE TABLE IF NOT EXISTS estoque (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id UUID REFERENCES importacoes_estoque(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,
  quantidade    NUMERIC(14,2) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_estoque_importacao ON estoque(importacao_id);
CREATE INDEX IF NOT EXISTS idx_estoque_codigo     ON estoque(codigo);
CREATE INDEX IF NOT EXISTS idx_imp_est_criado     ON importacoes_estoque(criado_em DESC);

-- Desabilita RLS (sistema interno com autenticação própria via JWT)
ALTER TABLE usuarios            DISABLE ROW LEVEL SECURITY;
ALTER TABLE importacoes         DISABLE ROW LEVEL SECURITY;
ALTER TABLE vendas              DISABLE ROW LEVEL SECURITY;
ALTER TABLE importacoes_estoque DISABLE ROW LEVEL SECURITY;
ALTER TABLE estoque             DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- USUÁRIO ADMIN INICIAL
-- Senha padrão: Admin@2025  (altere após o primeiro login)
-- Hash gerado com bcrypt rounds=10
-- ============================================================
INSERT INTO usuarios (nome, email, senha_hash, perfil)
VALUES (
  'Administrador',
  'admin@stoll.com.br',
  '$2b$10$2bMWl.3YiKuiBFYO9n6EWe4PLp1gXZB5bltx28aLKKs3JtkI2VBAe',
  'admin'
) ON CONFLICT (email) DO NOTHING;
