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
