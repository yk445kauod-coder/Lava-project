/**
 * Agentic endpoints: the answer engine, reports, comparison, charts, and
 * document export.
 *
 * `/ask` streams SSE; `/ask-sync` returns the same result as JSON. Both share
 * one runner so a programmatic caller and the dashboard can never disagree.
 */
import type { Env } from "../db";
import { badRequest, json, readJson } from "../http";
import { sseResponse } from "../sse";
import { runAgent, runAgentic, buildChart, compareExperiments } from "../agent";
import { buildReport, renderMarkdown } from "../report";
import { renderSvg } from "../viz";
import { markdownToPdf, markdownToDocx, safeFilename, type ChartSpec } from "../export";

export async function handleAgentRoutes(request: Request, url: URL, env: Env): Promise<Response | null> {
  const { pathname } = url;

  if (request.method === "POST" && pathname === "/report") {
    const body = await readJson<{ topic?: string; questions?: string[]; k?: number; model?: string; max_questions?: number; stream?: boolean }>(request);
    const topic = String(body.topic ?? "").trim();
    if (!topic) throw badRequest("missing 'topic'");

    // Streaming form: emit one event per finished question, then the report.
    // A six-question report cannot fit in a single response budget, so the
    // dashboard reads progress and renders the report as it completes.
    if (body.stream) {
      return sseResponse(async (emit) => {
        const report = await buildReport(env, topic, body.questions, Number(body.k ?? 8),
                                         body.model, body.max_questions, emit);
        emit("done", { report, markdown: renderMarkdown(report) });
      });
    }
    const report = await buildReport(env, topic, body.questions, Number(body.k ?? 8),
                                     body.model, body.max_questions);
    return json({ report, markdown: renderMarkdown(report) });
  }

  // Export: turn markdown into a downloadable PDF or DOCX
  if (request.method === "POST" && pathname === "/export") {
    const body = await readJson<{ markdown?: string; format?: string; filename?: string; title?: string; charts?: ChartSpec[] }>(request);
    const md = String(body.markdown ?? "");
    if (!md.trim()) throw badRequest("markdown is required");
    const format = String(body.format ?? "pdf").toLowerCase();
    const name = safeFilename(String(body.filename ?? body.title ?? "lava-report"));
    // Charts are supplied as specs so the writer can render them for the
    // target format: vector operators for PDF, a PNG for DOCX.
    const charts: ChartSpec[] = Array.isArray(body.charts) ? body.charts : [];
    const title = String(body.title ?? "LAVA Research Report");
    if (format === "docx") {
      return new Response(await markdownToDocx(md, title, charts), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": `attachment; filename="${name}.docx"`,
        },
      });
    }
    if (format === "md") {
      return new Response(md, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${name}.md"`,
        },
      });
    }
    if (format !== "pdf") throw badRequest(`unsupported format '${format}'`);
    return new Response(markdownToPdf(md, title, charts), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name}.pdf"`,
      },
    });
  }

  // Visualisation: build a chart from real measured values
  //
  // The agent calls this instead of inventing numbers: it selects a dataset
  // from `ignis.dataset_row`, so every plotted point is a recorded
  // measurement. Returns the SVG for inline display plus the spec the export
  // endpoint needs to embed the same chart in a PDF or DOCX.
  if (request.method === "POST" && pathname === "/visualize") {
    const body = await readJson<{ dataset?: string; type?: string; limit?: number; group_by?: string; title?: string; x_label?: string; y_label?: string }>(request);
    const datasetKey = String(body.dataset ?? "").trim();
    if (!datasetKey) throw badRequest("missing 'dataset'");
    const chartType = String(body.type ?? "bar");
    if (!["bar", "line", "scatter"].includes(chartType)) {
      throw badRequest(`unsupported chart type '${chartType}'`);
    }
    const built = await buildChart(env, {
      dataset: datasetKey,
      type: chartType as ChartSpec["type"],
      limit: body.limit,
      group_by: body.group_by === "experiment" ? "experiment" : undefined,
      title: body.title,
    });
    if ("error" in built) throw badRequest(built.error);
    return json({
      spec: built.spec,
      svg: renderSvg(built.spec),
      dataset: built.meta,
      rows: built.rows,
      note: "Values are measurements mined from NTRS report text, not a curated NASA dataset.",
    });
  }

  if (request.method === "POST" && pathname === "/compare") {
    const body = await readJson<{ experiments?: string[]; topic?: string }>(request);
    const codes: string[] = (body.experiments || []).filter(Boolean);
    if (!codes.length) throw badRequest("provide at least one experiment code");
    return json(await compareExperiments(env, codes, body.topic || null));
  }

  // Ask: the answer engine (streaming or JSON)
  if (request.method === "POST" && (pathname === "/ask" || pathname === "/ask-sync")) {
    const body = await readJson<{ question?: string; mode?: string; model?: string; k?: number; conversation_id?: string }>(request);
    const question = String(body.question ?? "").trim();
    if (!question) throw badRequest("missing question");
    const mode: "fast" | "deep" = body.mode === "deep" ? "deep" : "fast";
    const model = typeof body.model === "string" && body.model ? body.model : undefined;
    const k = Number(body.k) > 0 ? Number(body.k) : 8;
    const conversationId = typeof body.conversation_id === "string" && body.conversation_id
      ? body.conversation_id : undefined;

    // The agentic loop is the default because it lets the model choose its own
    // retrieval path. `pipeline=1` keeps the older fixed plan->retrieve->synth
    // route reachable for comparison and as a fallback.
    const usePipeline = url.searchParams.get("pipeline") === "1";
    const runner = usePipeline ? runAgent : runAgentic;
    const userId = ((request as any).user?.id as string | undefined) ?? null;

    // Non-streaming JSON form for programmatic callers.
    if (pathname === "/ask-sync") {
      return json(await runner(env, question, mode, model, k, () => {}, conversationId, userId));
    }

    return sseResponse((emit) =>
      runner(env, question, mode, model, k, emit, conversationId, userId)
        .then((result) => emit("done", result)));
  }

  return null;
}
