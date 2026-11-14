import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { MarketingHeader } from "../../components/MarketingHeader";
import { BrandLogo } from "../../components/BrandLogo";
import { MicrogravityFlame, type FlameState } from "../../components/MicrogravityFlame";
import { Reveal } from "../../components/Reveal";
import { Icon } from "../../components/Icon";
import { categoryLabel, fmt } from "../../lib/format";
import { useApi } from "../../lib/useApi";
import { useI18n } from "../../lib/i18n/provider";

const HEADLINE = "Understand how fire behaves when gravity disappears.";
const LEAD =
  "LAVA brings microgravity combustion experiments, datasets and a research assistant into one workspace, so researchers spend less time collecting data and more time answering questions.";

const CAPTIONS: Record<FlameState, { b: string; text: string }> = {
  earth: {
    b: "Buoyancy shapes the flame.",
    text: "Hot gas rises and draws fresh air in from below, stretching the flame into a teardrop.",
  },
  micro: {
    b: "Without buoyancy, the flame turns round.",
    text: "Oxygen reaches it only by diffusion, so the flame is cooler, slower and roughly spherical.",
  },
};

const FACTS = [
  { b: "~10⁻⁶ g", s: "Typical residual gravity on the ISS" },
  { b: "Diffusion", s: "Oxygen reaches the flame without buoyant flow" },
  { b: "Spherical", s: "Flame shape with no convection" },
  { b: "Safer fires", s: "Spacecraft fire safety is a core research goal" },
];

const PILLARS = [
  { icon: "book", to: "/experiments", b: "Campaign evidence", s: "Read every NASA document tied to a campaign, with its measured conditions." },
  { icon: "chart", to: "/datasets", b: "Measurements and data", s: "See the oxygen, pressure and flow values each source reports, and where they are missing." },
  { icon: "shield", to: "/coverage", b: "Coverage and gaps", s: "Check whether a scenario sits inside the tested envelope before you trust it." },
  { icon: "comments", to: "/chat", b: "Grounded answers", s: "Ask in Arabic or English and get an answer that cites the passage behind every claim." },
  { icon: "file", to: "/reports", b: "Research briefs", s: "Turn a question into a short report you can hand to a teammate." },
  { icon: "compare", to: "/compare", b: "Comparisons", s: "Put two campaigns side by side and see where their conditions diverge." },
];

const STEPS = [
  { n: "1", b: "Pick a campaign", p: "Open any of the eight microgravity combustion campaigns and its source documents." },
  { n: "2", b: "Read what was measured", p: "Each answer shows the oxygen, pressure and flow conditions the source reports, and the gaps where it does not." },
  { n: "3", b: "Ask and cite", p: "Ask a question in your own language and get an answer with the exact passage behind it." },
];

interface Health {
  stats?: {
    documents?: unknown; chunks?: unknown; findings?: unknown; experiments?: unknown;
    embeddings?: unknown; embedding_coverage?: unknown; vectors_complete?: unknown;
  };
}
interface Insight { title?: string; severity?: string; category?: string; supporting_documents?: unknown[] }

/** Counts a number up once on mount; falls back to the final value when motion
 *  is reduced or the element never intersects. */
function CountUp({ value }: { value: unknown }) {
  const [n, setN] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const target = Number(value);
    if (!Number.isFinite(target)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(target);
      return;
    }
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - startedAt) / 900);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span ref={ref}>{n === null ? fmt(value) : fmt(n)}</span>;
}

function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      v.pause();
      v.removeAttribute("autoplay");
      return;
    }
    const play = () => v.play().catch(() => undefined);
    play();
    const onVis = () => (document.hidden ? v.pause() : play());
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return (
    <video ref={ref} className="hero-video" autoPlay muted loop playsInline preload="metadata" poster="/assets/earth-poster.webp" aria-hidden="true">
      <source src="/assets/earth.mp4" type="video/mp4" />
    </video>
  );
}

function ScienceCard() {
  const { t } = useI18n();
  const [mode, setMode] = useState<FlameState>("earth");
  // Once the visitor picks a state, the automatic rotation stops and their
  // choice is kept, so the flame and its caption never contradict each other.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (touched) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setMode((m) => (m === "earth" ? "micro" : "earth")), 5500);
    return () => clearInterval(id);
  }, [touched]);

  const pick = (next: FlameState) => {
    setTouched(true);
    setMode(next);
  };

  const cap = CAPTIONS[mode];
  return (
    <Reveal as="figure" className="lab">
      <div className="seg" role="group" aria-label={t("Choose environment")}>
        <button type="button" aria-pressed={mode === "earth"} onClick={() => pick("earth")}>
          {t("On Earth")}
        </button>
        <button type="button" aria-pressed={mode === "micro"} onClick={() => pick("micro")}>
          {t("In microgravity")}
        </button>
      </div>
      <div className="view" data-mode={mode}>
        <MicrogravityFlame state={mode} onToggle={() => pick(mode === "earth" ? "micro" : "earth")} width="min(64%, 320px)" />
      </div>
      <figcaption key={mode} className="lab-cap">
        <b>{t(cap.b)}</b> {t(cap.text)}
      </figcaption>
      <p className="lab-note">{t("Stylized illustration. Real flame shape and colour depend on the fuel and the test conditions.")}</p>
    </Reveal>
  );
}

function LiveSnapshot() {
  const { t } = useI18n();
  const health = useApi<Health>("/api/health");
  const insights = useApi<{ insights?: Insight[] }>("/api/insights");
  const s = health.data?.stats || {};
  const insight = insights.data?.insights?.[0];
  const offline = !health.loading && !!health.error;

  return (
    <Reveal className="live" delay={70}>
      <img className="live-spark" src="/assets/spark.webp" alt="" aria-hidden="true" />
      <div className="live-head">
        <span className="dot" /> {t("Live corpus snapshot")} <span className="mono">NASA NTRS</span>
      </div>
      <div className="live-grid">
        <div className="live-cell"><b><CountUp value={s.documents} /></b><span>{t("documents")}</span></div>
        <div className="live-cell"><b><CountUp value={s.chunks} /></b><span>{t("indexed passages")}</span></div>
        <div className="live-cell"><b><CountUp value={s.findings} /></b><span>{t("findings")}</span></div>
        <div className="live-cell"><b><CountUp value={s.experiments} /></b><span>{t("experiments")}</span></div>
      </div>
      {s.vectors_complete === false && (
        <p className="live-coverage small muted">
          {t("Vector index covers {n}% of passages; search fuses keyword matching so every passage stays reachable.")
            .replace("{n}", String(Math.round((Number(s.embedding_coverage) || 0) * 100)))}
        </p>
      )}
      <div className="live-find">
        {insight ? (
          <>
            <b>{t(insight.title || "")}</b>
            <div className="meta">
              <span>{t(categoryLabel(insight.category))}</span>
              <span>·</span>
              <span>{(insight.supporting_documents || []).length} {t("sources")}</span>
            </div>
          </>
        ) : (
          <div className="meta">
            {offline
              ? t("Corpus stats load from the live worker when the backend is reachable.")
              : t("loading...")}
          </div>
        )}
      </div>
      <Link className="btn primary sm" to="/dashboard">{t("Open Mission Overview")}</Link>
    </Reveal>
  );
}

export default function Landing() {
  const { t } = useI18n();
  const headline = t(HEADLINE);

  return (
    <div className="surface-landing">
      <MarketingHeader />
      <main>
        <section className="hero" id="top">
          <HeroVideo />
          <div className="hero-scrim" aria-hidden="true" />
          <div className="wrap hero-in">
            <Reveal className="hero-copy">
              <h1 className="hero-title">
                <span className="hero-title__plain">{headline}</span>
              </h1>
              <p className="lead">{t(LEAD)}</p>
              <div className="cta">
                <Link className="btn primary lg" to="/chat"><Icon name="comments" size={18} /> <span>{t("Ask LAVA Intelligence")}</span></Link>
                <Link className="btn light lg" to="/dashboard">{t("View mission control")}</Link>
              </div>
            </Reveal>
            <ScienceCard />
          </div>
          <img className="moon" src="/assets/moon.webp" alt="" aria-hidden="true" />
          <div className="hero-fade" aria-hidden="true" />
        </section>

        <section className="band" id="science">
          <div className="wrap facts">
            {FACTS.map((f) => (
              <div key={f.b}>
                <b className="mono">{t(f.b)}</b>
                <span>{t(f.s)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="sec pillars" id="features">
          <img className="wave" src="/assets/wave1.webp" alt="" aria-hidden="true" />
          <div className="wrap">
            <h2>{t("What the platform does")}</h2>
            <p className="sub">{t("Six entry points, each tied to a real page in the console.")}</p>
            <div className="grid">
              {PILLARS.map((p) => (
                <Reveal key={p.b} as={Link} to={p.to} className="card">
                  <Icon name={p.icon} size={19} />
                  <b>{t(p.b)}</b>
                  <span>{t(p.s)}</span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="sec alt" id="workflow">
          <div className="wrap">
            <h2>{t("From a campaign to a cited answer in three steps")}</h2>
            <ol className="steps">
              {STEPS.map((s) => (
                <Reveal key={s.n} as="li">
                  <b>{t(s.b)}</b>
                  <p>{t(s.p)}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section className="sec corpus" id="corpus">
          <div className="wrap split">
            <Reveal>
              <h2>{t("LAVA Intelligence knows which experiment you are looking at")}</h2>
              <p className="sub left">
                {t("Every answer is tied to a research context: the experiment, dataset and category in use. LAVA Intelligence plans, retrieves and grades passages, then cites every claim.")}
              </p>
              <Link className="btn primary" to="/chat">{t("Open LAVA Intelligence")}</Link>
            </Reveal>
            <LiveSnapshot />
          </div>
        </section>

        <section className="sec mission">
          <div className="wrap mission-in">
            <Reveal as="figure" className="mission-art"><img src="/assets/satellite.webp" alt="" aria-hidden="true" /></Reveal>
            <Reveal className="mission-copy">
              <h2>{t("Grounded answers, not guesses")}</h2>
              <p>{t("LAVA reads the primary literature and answers only from retrieved passages. When the corpus does not cover something, it says so instead of inventing a result.")}</p>
              <Link className="btn primary" to="/chat">{t("Ask a question")}</Link>
            </Reveal>
          </div>
        </section>

        <section className="sec mission rev">
          <div className="wrap mission-in">
            <Reveal className="mission-copy">
              <h2>{t("How an answer is put together")}</h2>
              <p>{t("Each question runs a plan, retrieve, grade, expand, synthesise and verify loop, so the answer reflects the strongest evidence in the corpus rather than the first passage found.")}</p>
              <Link className="btn primary" to="/reports">{t("See research reports")}</Link>
            </Reveal>
            <Reveal as="figure" className="mission-art"><img src="/assets/rocket.webp" alt="" aria-hidden="true" /></Reveal>
          </div>
        </section>

        <section className="cta-band">
          <img className="wave rev" src="/assets/wave2.webp" alt="" aria-hidden="true" />
          <div className="wrap">
            <h2>{t("Start with a question")}</h2>
            <p>{t("Sign in to open mission control, or jump straight into the assistant.")}</p>
            <div className="cta c">
              <Link className="btn light lg" to="/login">{t("Sign in")}</Link>
              <Link className="btn primary lg" to="/chat">{t("Open LAVA Intelligence")}</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
            <BrandLogo className="brand" />
          <p>{t("Microgravity combustion research over the NASA NTRS corpus.")}</p>
          <nav>
            <Link to="/login">{t("Sign in")}</Link>
            <Link to="/dashboard">{t("Mission Overview")}</Link>
            <Link to="/chat">{t("LAVA Intelligence")}</Link>
            <Link to="/explorer">{t("Explorer")}</Link>
            <Link to="/about">{t("About")}</Link>
          </nav>
        </div>
        <div className="wrap foot-note">
          <p>
            {t("Answers are drafted by our own retrieval and writing pipeline over the NASA NTRS corpus.")}
            {" "}
            {t("Not affiliated with or endorsed by NASA.")}
          </p>
        </div>
      </footer>
    </div>
  );
}
