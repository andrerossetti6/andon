-- ─────────────────────────────────────────────────────────────
-- Planos de Previsão de Demanda (SIGS)
-- Guarda versões de trabalho da previsão: parâmetros + edições do usuário.
-- A "base" (previsão crua de Vendas + Banco) NÃO fica aqui — é sempre recomputada.
-- Rode este SQL no Supabase (SQL Editor → New query → Run).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS previsao_plano (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  params        JSONB   DEFAULT '{}',   -- { historico, horizonte, metodo, agrupamento, segmento, usarClientes }
  edicoes       JSONB   DEFAULT '{}',   -- { overrides:{mes_cod:qty}, excluidos:[cod], adicionados:[{codigo,descricao,segmento,meses:{mes:qty}}] }
  congelado     BOOLEAN DEFAULT false,
  snapshot      JSONB   DEFAULT '{}',   -- números congelados quando congelado=true: { mes_cod: qty }
  usuario_id    UUID REFERENCES usuarios(id),
  criado_em     TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE previsao_plano DISABLE ROW LEVEL SECURITY;
