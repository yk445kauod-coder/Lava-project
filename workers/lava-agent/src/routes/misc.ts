/**
 * Locale and diagnostics endpoints.
 *
 * /locales and /translate back the dashboard's i18n; /debug and /debug-llm are
 * liveness probes for the gateway hop.
 */
import type { Env } from "../db";
import { ApiError, badRequest, json, readJson } from "../http";
import { gatewayFetch, llmComplete, synthBudgets, DEFAULT_FAST_MODEL } from "../llm";
import { refreshInsights } from "../insights";
import { LOCALE_CODES, LOCALES, translateStrings } from "../i18n";

export async function handleMiscRoutes(request: Request, url: URL, env: Env): Promise<Response | null> {
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/locales") {
    return json({ locales: LOCALES, default: "en" });
  }

  if (request.method === "POST" && pathname === "/translate") {
    const body = await readJson<{ locale?: string; strings?: string[] }>(request);
    const locale = String(body.locale ?? "en").toLowerCase();
    if (!LOCALE_CODES.has(locale)) {
      throw badRequest(`unsupported locale ${locale}`);
    }
    const strings: string[] = Array.isArray(body.strings)
      ? body.strings.slice(0, 400).map((s: any) => String(s ?? "").slice(0, 4000))
      : [];
    if (!strings.length) return json({ locale, translations: {}, cached: 0 });
    const translations = await translateStrings(env, locale, strings);
    return json({ locale, translations });
  }

  if (request.method === "GET" && pathname === "/models") {
    // Proxy the gateway's stealth-model registry so the dashboard has one
    // source of truth for the selectable models.
    try {
      const r = await gatewayFetch(env, "/v1/models", { headers: { authorization: `Bearer ${env.LAVA_PROXY_TOKEN}` } });
      return new Response(await r.text(), {
        status: r.status,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
      });
    } catch (e: any) {
      return json({ error: String(e?.message ?? e) }, 502);
    }
  }

  if (request.method === "GET" && pathname === "/debug") {
    const target = `${env.LAVA_GATEWAY_URL}/health`;
    const info: any = { target, tokenSet: Boolean(env.LAVA_PROXY_TOKEN), bound: Boolean(env.GATEWAY) };
    try {
      const r = await gatewayFetch(env, "/health", { headers: { authorization: `Bearer ${env.LAVA_PROXY_TOKEN}` } });
      info.status = r.status;
      info.body = (await r.text()).slice(0, 300);
    } catch (e: any) {
      info.error = String(e?.message ?? e);
    }
    return json(info);
  }

  if (request.method === "GET" && pathname === "/debug-llm") {
    const info: any = { model: url.searchParams.get("model") || DEFAULT_FAST_MODEL };
    try {
      const raw = await llmComplete(env, "Return JSON.", '{"ping": true}', info.model, true, synthBudgets(info.model)[0]);
      info.ok = true;
      info.raw = raw.slice(0, 300);
    } catch (e: any) {
      info.ok = false;
      info.error = String(e?.message ?? e);
    }
    return json(info);
  }

  // Refresh the SI-written fire-safety insights. One model call per topic, so
  // it runs out of band and is guarded by a shared secret rather than a session:
  // the caller is the operator's pipeline, not a browser.
  if (request.method === "POST" && pathname === "/admin/insights/refresh") {
    const token = request.headers.get("x-lava-admin") || "";
    const expected = env.LAVA_INSIGHT_TOKEN || "";
    if (!expected || token !== expected) {
      throw new ApiError(403, "admin token required", "forbidden");
    }
    const body = await readJson<{ model?: string }>(request).catch(() => ({}) as any);
    const report = await refreshInsights(env, body?.model ? String(body.model) : undefined);
    return json(report);
  }

  return null;
}
