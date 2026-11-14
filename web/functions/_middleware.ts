/**
 * Cloudflare Pages middleware for the LAVA dashboard.
 *
 * A tab left open across a deploy keeps HTML that names the previous build's
 * hashed chunks. Asking for one of those chunks used to fall through to the SPA
 * fallback (`/* /index.html 200`), which answers with HTML; the browser then
 * tries to run HTML as a module, the dynamic import rejects, and the user sees a
 * raw error. This runs before the fallback and, when a requested module is
 * genuinely missing, returns a small module that reloads the tab onto the
 * current deployment instead.
 *
 * A `_redirects` rule cannot do this: its patterns also match files that do
 * exist and replace them, so every real chunk would be served as the fallback.
 * Checking the fetch result lets present assets pass through untouched.
 */
const MODULE_RE = /^\/assets\/[^/]+\.js$/;

const RELOAD_MODULE = `(function () {
  var KEY = "lava.chunkFallbackAt";
  try {
    var last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch (e) {}
  var url = location.pathname + location.search;
  url += (url.indexOf("?") === -1 ? "?" : "&") + "v=" + Date.now();
  location.replace(url);
})();`;

/** The slice of the Pages Function context this needs, so the file type-checks
 *  without the Cloudflare ambient types. */
type Context = { request: Request; next: () => Promise<Response> };

export const onRequest = async (context: Context): Promise<Response> => {
  const response = await context.next();
  if (!MODULE_RE.test(new URL(context.request.url).pathname)) return response;
  const type = response.headers.get("content-type") || "";
  // Real assets are served as JavaScript. A missing one is the SPA fallback
  // (HTML, status 200) or a straight 404; either way the browser cannot run it,
  // so answer with a module that reloads the tab onto the current deployment.
  const isHtmlOr404 = response.status === 404 || type.includes("text/html");
  if (!isHtmlOr404) return response;
  return new Response(RELOAD_MODULE, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
};
