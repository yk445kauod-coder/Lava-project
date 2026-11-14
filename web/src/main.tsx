import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// A tab left open across a deploy holds HTML that names the previous build's
// hashed chunks. Loading one of those fails with a raw "Failed to fetch
// dynamically imported module" screen. Reloading fetches the current HTML and
// its matching chunks, so recover automatically - but only if the last reload
// was a while ago, so a genuinely broken deploy surfaces the error boundary
// instead of reloading in a loop.
const RELOAD_KEY = "lava.reloadedAt";
const RELOAD_WINDOW_MS = 10_000;
window.addEventListener("vite:preloadError", (event) => {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  if (Date.now() - last < RELOAD_WINDOW_MS) return;
  event.preventDefault();
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
});

// Page stylesheets are scoped to their page root by scripts/scope_css.py so
// they can coexist in one bundle; the token/global layer loads last.
import "./styles/app.scoped.css";
import "./styles/styles.scoped.css";
import "./styles/home.scoped.css";
import "./styles/login.scoped.css";
import "./styles/tokens.css";
import "./styles/global.css";
import { I18nProvider } from "./lib/i18n/provider";
import { AuthProvider } from "./lib/auth";
import App from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
