import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { BrandLogo } from "../../components/BrandLogo";
import { Icon } from "../../components/Icon";
import { LangMenu } from "../../components/LangMenu";
import { ThemeToggle } from "../../components/ThemeToggle";
import { Toast, useToast } from "../../components/Toast";
import { useAuth } from "../../lib/auth";
import { useI18n } from "../../lib/i18n/provider";
import { getJSON, setJSON } from "../../lib/storage";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function DecorativeHero() {
  const { t } = useI18n();
  return (
    <section className="hero" aria-hidden="true">
      <div className="hero-top">
        <BrandLogo />
      </div>
      <div className="stage">
        <svg viewBox="0 0 400 400" className="flame">
          <defs>
            <radialGradient id="core" cx="50%" cy="50%" r="50%">
              <stop offset="0" stopColor="#fff" stopOpacity=".95" />
              <stop offset=".25" stopColor="#FFBD69" />
              <stop offset=".6" stopColor="#F07836" />
              <stop offset="1" stopColor="#F07836" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="halo" cx="50%" cy="50%" r="50%">
              <stop offset=".5" stopColor="#4779A8" stopOpacity="0" />
              <stop offset="1" stopColor="#4779A8" stopOpacity=".35" />
            </radialGradient>
          </defs>
          <circle className="glow" cx="200" cy="200" r="168" fill="url(#halo)" />
          <g className="rings" fill="none" stroke="#4779A8" strokeOpacity=".5">
            <circle cx="200" cy="200" r="190" />
            <circle cx="200" cy="200" r="150" strokeDasharray="2 8" />
            <circle cx="200" cy="200" r="112" />
          </g>
          <circle className="orb" cx="200" cy="200" r="92" fill="url(#core)" />
          <circle className="orb-core" cx="200" cy="196" r="30" fill="#FFFDF6" opacity=".5" />
          <g className="spin"><circle cx="200" cy="10" r="5" fill="#FFBD69" /></g>
          <g className="spin slow"><circle cx="50" cy="200" r="4" fill="#fff" fillOpacity=".8" /></g>
          <g className="spin rev"><circle cx="200" cy="350" r="3.5" fill="#F07836" /></g>
          <g className="spin fast"><circle cx="200" cy="60" r="3" fill="#9FD3F5" /></g>
          <g className="spin slow rev"><circle cx="340" cy="200" r="2.6" fill="#FFE7A8" /></g>
        </svg>
      </div>
      <div className="hero-copy">
        <h2>{t("Without gravity, fire becomes a sphere")}</h2>
        <p>{t("LAVA helps researchers read what microgravity combustion experiments reveal, from flame spread to cool flames.")}</p>
        <div className="stats">
          <div><b className="mono">10⁻⁶ g</b><span>{t("Typical ISS level")}</span></div>
          <div><b className="mono">100%</b><span>{t("Claims cited to a source")}</span></div>
        </div>
      </div>
    </section>
  );
}

export default function Login() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login, register } = useAuth();
  const [msg, toast] = useToast();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(() => getJSON<string>("lava.email", ""));
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(() => !!getJSON<string>("lava.email", ""));
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [busy, setBusy] = useState(false);

  const dest = (location.state as { from?: string } | null)?.from || "/dashboard";
  useEffect(() => {
    if (user) navigate(dest, { replace: true });
  }, [user, dest, navigate]);

  const checkEmail = () => {
    const v = email.trim();
    const m = !v ? "Enter your work email." : !EMAIL_RE.test(v) ? "Enter a valid email, like name@institute.org." : "";
    setEmailErr(m);
    return !m;
  };
  const checkPw = () => {
    const min = mode === "register" ? 8 : 6;
    const m = !pw ? "Enter your password." : pw.length < min ? `Use at least ${min} characters.` : "";
    setPwErr(m);
    return !m;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkEmail() || !checkPw()) return;
    setBusy(true);
    try {
      if (mode === "register") await register(email.trim(), pw, name.trim() || undefined);
      else await login(email.trim(), pw);
      setJSON("lava.email", remember ? email.trim() : "");
      navigate(dest, { replace: true });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="surface-login">
      <div className="shell">
        <DecorativeHero />

        <main className="pane">
          <div className="pane-tools">
            <LangMenu />
            <ThemeToggle />
          </div>
          <div className="box">
            <BrandLogo className="mob" />
            <h1>{mode === "register" ? t("Create your LAVA account") : t("Sign in to LAVA")}</h1>
            <p className="lead">{t("Access your experiments, datasets and the LAVA research assistant.")}</p>
            <div className="demo">
              <Icon name="shield" size={16} />{" "}
              {mode === "register"
                ? t("Passwords are hashed with PBKDF2 and never stored in plain text.")
                : t("Sign in with the email and password you registered.")}
            </div>

            <form onSubmit={submit} noValidate>
              {mode === "register" && (
                <div className="field">
                  <label htmlFor="name">{t("Name (optional)")}</label>
                  <div className="ctl">
                    <Icon name="user" size={16} />
                    <input id="name" type="text" autoComplete="name" placeholder={t("Your name")}
                           value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                </div>
              )}
              <div className={`field${emailErr ? " bad" : ""}`}>
                <label htmlFor="email">{t("Work email")}</label>
                <div className="ctl">
                  <Icon name="user" size={16} />
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    placeholder="name@institute.org"
                    required
                    aria-invalid={!!emailErr}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailErr) checkEmail();
                    }}
                    onBlur={() => email && checkEmail()}
                  />
                </div>
                <p className="err" role="alert">{emailErr}</p>
              </div>

              <div className={`field${pwErr ? " bad" : ""}`}>
                <div className="lab-row">
                  <label htmlFor="pw">{t("Password")}</label>
                </div>
                <div className="ctl">
                  <Icon name="shield" size={16} />
                  <input
                    id="pw"
                    type={showPw ? "text" : "password"}
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                    placeholder={t("Enter your password")}
                    required
                    aria-invalid={!!pwErr}
                    value={pw}
                    onChange={(e) => {
                      setPw(e.target.value);
                      if (pwErr) checkPw();
                    }}
                    onBlur={() => pw && checkPw()}
                  />
                  <button
                    type="button"
                    className="eye"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    aria-pressed={showPw}
                    onClick={() => setShowPw((s) => !s)}
                  >
                    <Icon name={showPw ? "alert" : "info"} size={16} />
                  </button>
                </div>
                <p className="err" role="alert">{pwErr}</p>
              </div>

              <label className="check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span className="box" />
                {t("Remember me on this device")}
              </label>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? <span className="spinner" /> : null}
                <span>{busy ? t("Please wait...") : mode === "register" ? t("Create account") : t("Sign in")}</span>
                {!busy && <Icon name="arrowRight" size={16} />}
              </button>
            </form>

            <p className="foot">
              {mode === "register" ? t("Already have an account?") : t("New to LAVA?")}{" "}
              <button
                className="link"
                type="button"
                onClick={() => {
                  setMode((m) => (m === "register" ? "login" : "register"));
                  setPwErr("");
                  setEmailErr("");
                }}
              >
                {mode === "register" ? t("Sign in") : t("Create an account")}
              </button>
            </p>
          </div>
        </main>
      </div>
      <Toast message={msg} />
    </div>
  );
}
