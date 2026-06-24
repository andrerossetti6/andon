# Projeto Andon — dois sistemas no mesmo repositório

Este repositório hospeda **dois** sistemas que compartilham servidor (Express), banco (Supabase/PostgreSQL `icynkkfftjbrscwicpzd`) e tema visual (`style.css`):

1. **SIGS / Gestão Stoll** — sistema principal (órteses/compressão). SPA em `index.html` + `app.js`. Vendas, estoque, S&OP, Previsão, Política de Estoques, Plano de Produção, TOC (gargalo, inclusive por modelo Stoll), Preactor (sequenciamento APS) e MES de apontamento. Tabelas plurais (`maquinas`, `turnos`, `apontamentos`).
2. **MES Malha Forte** — sistema têxtil NOVO (malharia/tinturaria/acabamento/revisão), construído por fases. PWA do operador em `mes.html` + `mes.js`. Tabelas singulares (`produto`, `maquina`, `operador`, `turno`, `apontamento`, `nao_conformidade`…). API sob `/api/mf/*`. NÃO confundir os domínios.

## Stack
- Backend: Node + **Express 5** (`server.js`), Supabase via `db.js` (service_role, RLS desabilitada por tabela).
- Frontend: HTML/CSS/JS **puro, sem framework**. `index.html`/`app.js` (SIGS) e `mes.html`/`mes.js` (Malha Forte, independente do app.js).
- Auth: JWT próprio + bcrypt. Token no localStorage `sin1_token`.
- Servidor sobe via **LaunchAgent** `com.stoll.sigs` (nunca rodar `node server.js` manual; reiniciar com `launchctl kickstart -k gui/$(id -u)/com.stoll.sigs`).

## MES Malha Forte — princípios (fases 0 e 1 prontas)
- **Captura única:** um registro de `apontamento` (sessão: OP+máquina+operador+turno) é a raiz; NCs e paradas penduram nele. CEP, CNQ, OEE e SGQ (fases 2-5) serão **VIEWS/consultas** sobre estas tabelas — nunca tabelas próprias.
- **Convenções do schema** (`mes_schema.sql`): PK UUID `gen_random_uuid()`, snake_case singular, `TIMESTAMPTZ`, enums por `TEXT`+`CHECK`, exclusão lógica (`ativo`), `NUMERIC(14,4)` dinheiro / `NUMERIC(14,3)` qtd, `criado_em`/`atualizado_em` via trigger `set_atualizado_em`.
- **Defeito é SEMPRE do catálogo** (`catalogo_defeito`), nunca texto livre. O legado é traduzido via `de_para_defeito` (exato → fuzzy → subagente classificador).
- **Severidade da NC é congelada** (`severidade_aplicada`) no momento do registro.
- **Gatilhos de RNC** (`gatilho_rnc`): ao gravar NC, avalia volume (qtd/%) e recorrência (janela) → marca `gera_rnc`.
- **Fotos** das NCs vão para o Supabase **Storage** (bucket `mf-fotos`, público); a tabela `foto` guarda só a URL + metadados.

## Convenções de trabalho neste repo
- Sempre testar no browser (puppeteer-core + Chrome do sistema, token JWT do `.env`) antes de concluir. Bootstrap é crítico — null-guard em tudo que `getElementById` no boot.
- Handlers inline `onclick="x.metodo()"` resolvem nomes pelo scope chain antes do global — não usar nomes que colidam com `document`/`window`/element (ex.: `timeline` colidia com `document.timeline`).
- Colunas de planilhas importadas vêm com espaços finais (`"Segmento "`); usar lookup tolerante (trim+lowercase).
- Tabela nova no Supabase: adicionar em `mes_schema.sql`/`server.js` e rodar SQL no SQL Editor (ou `/setup` no SIGS).
