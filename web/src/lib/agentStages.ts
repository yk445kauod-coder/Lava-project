import { fmt, pct } from "./format";

/** SSE stage names emitted by the worker, mapped to short console labels. */
export const STAGE_LABEL: Record<string, string> = {
  memory: "recall",
  mode: "setup",
  plan: "plan",
  retrieve: "retrieve",
  grade: "grade",
  expand: "expand",
  act: "reason",
  final: "answer",
  translate: "translate",
  synthesizing: "synthesize",
  synthesize: "synthesize",
  verify: "verify",
  memory_write: "remember",
  visualize: "visualize",
  done: "done",
};

type Translate = (s: string) => string;

/** A one-line description of what happened at a stage, for the live timeline.
 *  The caller passes the app's `t` so the sentence renders in the active
 *  language. When it is omitted (e.g. in tests) the English template is used. */
export function stageDetail(name: string, d: Record<string, unknown>, t: Translate = (s) => s): string {
  switch (name) {
    case "memory":
      return t("recalled {n} memories").replace("{n}", fmt(d.n_recalled));
    case "mode":
      return `${d.mode} · ${d.model}${Number(d.max_iterations) > 1 ? ` · ≤${d.max_iterations} ${t("passes")}` : ""}`;
    case "plan":
      return t("split into {n} sub-questions").replace("{n}", String((d.sub_questions as unknown[] | undefined)?.length ?? 0));
    case "retrieve":
      return `"${String(d.sub_question ?? "").slice(0, 60)}" → ${fmt(d.n_hits ?? 0)} ${t("passages")}`;
    case "grade":
      return `${t("evidence")} ${d.verdict ?? ""}`;
    case "expand":
      return t("query rewritten");
    case "act":
      return `${t("pass")} ${d.iteration ?? "?"} · ${d.tool ?? t("thinking")}`;
    case "final":
      return t("answered after {n} passes").replace("{n}", String(d.iteration ?? "?"));
    case "translate":
      return d.to === "en" ? t("translated the question for retrieval") : `${t("wrote the answer in")} ${d.to}`;
    case "synthesizing":
      return t("writing the answer from {n} passages").replace("{n}", fmt(d.passages ?? 0));
    case "synthesize":
      return `${d.model ?? t("model")} ${t("drafted {n} cited claims").replace("{n}", fmt(d.claims ?? 0))}`;
    case "verify":
      return t("{n}% traced to a passage").replace("{n}", pct(d.verified_ratio));
    case "memory_write":
      return t("saved {n} findings").replace("{n}", fmt(d.n_claims ?? 0));
    case "visualize":
      return `${d.type ?? t("chart")} · ${fmt(d.points ?? 0)} ${t("values")}`;
    default:
      return "";
  }
}

/** stop_reason values that mean the answer is complete. Anything else is a
 *  partial run the UI must surface (budget/deadline/parse_error/model_error) or
 *  the deterministic rescue dump (synth_failed). */
const COMPLETE = new Set(["final_answer", "forced_synthesis"]);

export function isPartial(stopReason?: string): boolean {
  return !!stopReason && !COMPLETE.has(stopReason);
}

export const STOP_LABEL: Record<string, string> = {
  budget: "the agent reached its step limit before synthesizing - ask again or switch to Deep mode",
  deadline: "the run exceeded the time budget - try a narrower question",
  parse_error: "the model's output could not be parsed",
  model_error: "the model call failed",
  synth_failed: "synthesis failed - showing retrieved passages instead",
};
