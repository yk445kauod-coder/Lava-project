# API

All responses are JSON. The dashboard calls the worker through the Pages Function at
`/api/*`, so the browser stays on one origin. The worker is also reachable directly at
`https://lava-agent.yk445kauod.workers.dev`.

Bigint columns come back as **strings** (JavaScript loses precision on large ints), so
cast with `Number()` before doing arithmetic. Times are ISO-8601 UTC.

Errors are `{"error": "<message>"}` with a non-2xx status. The message is written for a
developer; the UI should show its own text.

## Auth

Private routes need `Authorization: Bearer <token>`.

| Method | Path | Body |
|---|---|---|
| POST | `/api/auth/register` | `{ email, password, name? }` |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/logout` | - |
| GET | `/api/auth/me` | - |
| POST | `/api/auth/password` | `{ current, next }` |

`401 invalid_credentials` covers a wrong password and an unknown email alike.
`409 email_taken` means the email already exists.

Reads are open so the dashboard works before sign-in: `GET` on `/health`,
`/stats`, `/experiments`, `/insights`, `/documents`, `/datasets`, `/psi`,
`/coverage`, `/global-search`, `/search`, `/rank`, `/locales` and the
`/experiments/*`, `/documents/*`, `/datasets/*`, `/psi/*` details, plus `POST
/translate`. Everything else needs a token: the `POST` routes that run the agent
or build a file (`/ask`, `/ask-sync`, `/report`, `/export`, `/compare`) and
`GET /memory`.

## Data routes

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness + corpus counts. Cheap; use it for the header dot. |
| GET | `/api/stats` | Everything Mission Control renders, in one call. |
| GET | `/api/documents` | `q`, `kind`, `experiment`, `limit` (max 100), `offset`. Page against `total`, not `documents.length`. |
| GET | `/api/documents/:id` | One document + chunks + findings. `id` is the internal id, not the NTRS `source_id`. |
| GET | `/api/experiments` | Campaigns and facilities. |
| GET | `/api/experiments/:code` | One campaign with its documents and findings. |
| GET | `/api/search` | Hybrid retrieval only, no generation. Good for debugging a citation. `k` max 50. |
| GET | `/api/rank` | Same retrieval as `/api/search`, plus the score behind every passage. `q`, `k`. |
| GET | `/api/insights` | Fire-safety insights the SI core wrote, metric distributions and per-campaign coverage. |
| GET | `/api/memory` | `conversation_id` (UUID) and `query`. |
| GET | `/api/locales` | Locale list and direction. |
| POST | `/api/compare` | `{ experiments: string[], topic? }`. |
| POST | `/api/report` | Multi-question report, streamed. |
| POST | `/api/export` | Render markdown as PDF or DOCX. |

`POST /api/admin/insights/refresh` is not part of the dashboard: it regenerates the insight
cards with one model call per topic and is guarded by the `x-lava-admin` header, checked
against the worker's `LAVA_INSIGHT_TOKEN` secret. The run replaces the previous set in one
transaction, so a reader never sees an empty panel. `npm run insights:refresh` calls it.

Nullable condition fields are common: `o2_fraction` and `pressure_kpa` are `null` for
many campaigns. Show "not reported", not `0`. In `/api/insights`, a `coverage` entry with
`documents: 0` is a real gap worth showing.

## Ranking

`/api/search` and `/api/rank` share one pipeline. Hybrid retrieval (vector + keyword)
fuses a candidate pool; a lexical rerank scores how much of the question each passage
covers and whether the terms sit together; a weighted blend adds source provenance and
domain fit; passages that share too little of the question are then dropped, and the rest
are diversified with MMR so one spreadsheet cannot fill the page. The PSI measured rows
are scored and merged in the same pass, so a question that names a quantity or a test id
surfaces real numbers next to the papers. PSI rows take at most a third of the slots: they
carry dense campaign labels, so on a conceptual question they can out-score the prose that
explains them and fill the whole list with numbers. Report passages keep the majority.

A question written in Arabic, Chinese or Russian is translated to English once, at the top
of the pipeline, because the corpus and its indexes are English. `/api/rank` returns the
same hits with `factors` (the per-signal breakdown), `why` (a plain-language reason for
the position) and `dropped` (how many candidates the relevance gate rejected).

## `POST /api/ask`

```json
{ "question": "...", "k": 8, "stream": true, "mode": "fast",
  "model": "si-1", "conversation_id": "3f2b..." }
```

| Field | Default | Notes |
|---|---|---|
| `question` | - | required |
| `k` | 8 | passages per retrieval pass |
| `stream` | false | `true` returns SSE |
| `mode` | `fast` | `deep` allows more loop iterations and time |
| `model` | `si-pulse` | see below |
| `conversation_id` | - | must be a UUID, or you get a 500 |

`POST /api/ask-sync` is the same without streaming. SSE events, in order: `mode`,
`memory`, `act`, `final`, `verify`, `synthesize`, `visualize`, `memory_write`, then
`done` (the full result) and `close`; `error` may replace them. The result carries
`answer` (markdown), `evidence[]`, `claims[]`, `sub_questions`, `confidence`,
`iterations` and `stop_reason`.

Two things matter when you render it. `answer` is markdown, so do not put it in a `<p>`
or a `white-space: pre-wrap` block. Citations are positional: `[3]` means `evidence[2]`,
so render `evidence` in the order given or the numbers point at the wrong passages.

`stop_reason` says how the run ended:

| Value | Meaning |
|---|---|
| `final_answer` | normal |
| `forced_synthesis` | hit the iteration limit, wrote from gathered evidence; treat as normal |
| `budget`, `deadline` | out of iterations or time |
| `parse_error` | the model never produced usable output |
| `model_error` | upstream provider failed |

Show the last three as degraded answers, because `answer` may be a short apology.

## Models

Callers pass a LAVA codename; the gateway maps it to a real upstream. `GET /api/models`
returns the live list. Flagship (`si-1`, `si-max`, `si-ultra`) routes to AgentRouter;
free (`si-nova*`, `si-pulse*`, `si-ember`) routes to Gemini, Groq and Cloudflare Workers
AI. If the requested provider is missing or errors, the gateway falls through the free
tier, and the response's `model` field reports what actually served it.

The flagship models are reasoning models: they spend hidden reasoning against the output
budget, so a low cap returns empty content. The worker retries with a bigger budget
before it falls back.
