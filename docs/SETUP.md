# Setup

Two parts: a Python pipeline that builds the corpus, and a React dashboard that reads it.
You can run the dashboard without the pipeline, because it talks to the deployed worker.

## Environment

```bash
cp .env.example .env
```

Fill in `DATABASE_URL` and `DATABASE_URL_POOLED` (a Neon Postgres 18 connection, direct
and pooled), plus `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`
and `S3_BUCKET` for the S3-compatible mirror of the PDFs and fulltext. The pipeline and
migrations use the direct URL; serverless queries use the pooled one. Python needs
`psycopg[binary]`, `requests` and `fastembed`. Never commit `.env`.

## Pipeline

```bash
npm run db:migrate        # apply db/migrations in order
npm run pipeline:collect  # harvest NTRS (default target 300 MB)
npm run pipeline:clean    # parse, normalise, dedupe, extract findings
npm run pipeline:index    # chunk + embed with fastembed (no API key)
npm run pipeline:analyze  # fire-safety insights
```

Already have the corpus and only want to rebuild the derived layers: `npm run
pipeline:rebuild`. Embeddings use `BAAI/bge-small-en-v1.5` (384-d); if you change the
model or dimension, the worker's `DB_EMBED_MODEL` has to match or the index is useless.

## Dashboard

```bash
npm run web:install
npm run web:dev     # http://localhost:5173, proxies /api/* to the worker
```

## Tests

`npm test` runs pytest (needs `DATABASE_URL`); `npm --prefix web test` runs vitest. The
Python tests hit the real Neon database, with no mocking layer, and skip themselves when
it is unreachable.

## Deploy

```bash
npm run worker:deploy   # deploy the lava-agent worker
npm run web:deploy      # build + publish to Cloudflare Pages
```

Worker secrets live in Cloudflare, not in `.env`:

```bash
cd workers/lava-agent
npx wrangler secret put NEON_DATABASE_URL
npx wrangler secret put LAVA_PROXY_TOKEN
npx wrangler secret put AGENTROUTER_API_KEY
npx wrangler secret put LAVA_INSIGHT_TOKEN
```

`LAVA_INSIGHT_TOKEN` guards `POST /admin/insights/refresh`. Generate one with
`python3 -c "import secrets;print(secrets.token_urlsafe(24))"`, put the same value in
`.env` as `LAVA_INSIGHT_TOKEN`, then run `npm run insights:refresh` to regenerate the
fire-safety insight cards.

## LLM providers

LAVA works with no LLM at all: with no provider configured it falls back to a
deterministic extractive synthesizer that quotes source sentences verbatim. To get
paraphrased answers, set any one of `OPENAI_API_KEY` (optional `OPENAI_BASE_URL`,
`LAVA_LLM_MODEL`), `OPENROUTER_API_KEY`, or `OLLAMA_BASE_URL`. The provider is
auto-detected and responses are cached in `ignis.llm_cache`.

## Database schema

Neon Postgres 18, everything in the `ignis` schema (set as the search path by migration
`0003`). Extensions: `vector` (pgvector, HNSW), `pg_trgm`, `pgcrypto`.

```
raw_record -> artifact                     harvest provenance + object storage
document -> document_text                  canonical, deduplicated corpus
  chunk -> chunk_embedding                 retrieval units + 384-d vectors
  finding                                  extracted metric / value / unit
  experiment_document -> experiment -> facility

agent_run -> agent_step                    agent observability
  retrieval_hit                            what was retrieved, per sub-question
  citation                                 what was cited + verification outcome

conversation -> message -> retrieval_hit
short_term_memory / long_term_memory       session and cross-session recall
insight, pipeline_run, llm_cache, dedupe_map, ui_translation, app_user, auth_session
```

Retrieval fuses keyword search (`ts_rank_cd` over a `tsvector`) with vector search
(cosine over HNSW-indexed embeddings) using Reciprocal Rank Fusion. The fused score is
scaled to a fixed range and blended with query coverage, phrase proximity, provenance
(corpus quality and recency) and combustion-domain density into a single `final_score`.
Maximal Marginal Relevance then drops near-duplicate passages before the top k are
returned. A question written in Arabic, Chinese, Russian or Japanese is translated to
English once, at the top of the retrieval path, because the corpus and its index are
English. The `/api/rank` endpoint returns the same pipeline with every factor exposed.
