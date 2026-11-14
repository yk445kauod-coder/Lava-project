import { Link } from "react-router-dom";

import { MarketingHeader } from "../../components/MarketingHeader";
import { BrandLogo } from "../../components/BrandLogo";
import { Reveal } from "../../components/Reveal";
import { Icon } from "../../components/Icon";
import { useI18n } from "../../lib/i18n/provider";

/** Team roster. Kept in the UI (not just docs) so the product credits the people
 *  behind each pipeline stage. `init` renders as the avatar monogram. */
const TEAM = [
  {
    init: "YK",
    name: "Yousef Khamis",
    role: "Team lead · RAG and backend",
    bio: "Holds the whole project together, and built the part that does the thinking. Ask LAVA a question and Yousef's work is what searches thousands of papers and keeps the answer honest.",
  },
  {
    init: "AE",
    name: "Aynoor Elhabashy",
    role: "Frontend & UI/UX",
    bio: "Designed and built every screen you're looking at. She sweats the details: Arabic that reads properly, buttons that keep their promises, pages that open quickly on a phone.",
  },
  {
    init: "YM",
    name: "Yousef Mostafa",
    role: "Data collection",
    bio: "Went and got the papers. He pulls in NASA's research archive, throws out the duplicates, and makes sure nothing gets lost along the way.",
  },
  {
    init: "SH",
    name: "Shahd",
    role: "Data cleaning",
    bio: "Takes the raw text and makes it usable: pulling out the real numbers, and the exact sentence each number came from, so you can check it yourself.",
  },
];

/** Method, end to end: what each step does and who owns it. */
const METHODS = [
  {
    step: "Collecting the data",
    text: "Pull in NASA's papers and their full text, drop the duplicates, and keep a copy of every PDF.",
  },
  {
    step: "Cleaning the data",
    text: "Tidy up the text and pull out the numbers, keeping the original sentence next to each one.",
  },
  {
    step: "Analysing the data",
    text: "Rank fire-safety findings by how serious they are, and map which conditions the experiments actually tested.",
  },
  {
    step: "Retrieval (RAG)",
    text: "Split the papers into passages, make them searchable, and blend keyword search with meaning-based search.",
  },
  {
    step: "Backend",
    text: "The API that serves the data and runs the assistant: a Cloudflare Worker over Neon Postgres, behind a sign-in.",
  },
  {
    step: "Model integration",
    text: "One gateway in front of several language models, so a run keeps going even when one provider is down.",
  },
  {
    step: "Frontend & UX",
    text: "The React app you're using, loaded page by page, with clear states for empty, offline and low-confidence results.",
  },
];

/** The audience the challenge names, so a reader knows who the product is for. */
const AUDIENCES = [
  {
    icon: "book",
    who: "Professors and educators",
    why: "A citable, checkable map of the microgravity combustion literature for lectures and reading lists.",
  },
  {
    icon: "brain",
    who: "Graduate and undergraduate students",
    why: "A place to see what was already measured, and where the open questions are, before starting a study.",
  },
  {
    icon: "telescope",
    who: "Aerospace researchers",
    why: "Condition-by-condition comparisons across investigations, with the gap stated instead of guessed at.",
  },
  {
    icon: "cpu",
    who: "Aerospace engineers",
    why: "The measured inputs a flammability model needs, and the controls and equipment the work informs.",
  },
];

/** Trust rules the team agreed on - the contract behind every number in the UI. */
const RULES = [
  "Every number we show is a candidate, not a fact. We put the quote and the source right next to it.",
  "Missing data stays missing, never zero: if a paper didn't report oxygen or pressure, we say so.",
  "We don't pretend to predict. Outside what the experiments covered, we call it a gap in the evidence.",
  "Citations don't move: [3] always points at the same passage, every time you ask.",
];

export default function About() {
  const { t } = useI18n();

  return (
    <div className="surface-landing">
      <MarketingHeader />

      <main>
        <section className="sec" id="about">
          <div className="wrap">
            <h1 className="about-title">{t("Who built LAVA")}</h1>
            <p className="about-lead">
              {t(
                "We're Astro-Tech, a team of four. We built LAVA for the NASA Space Apps Challenge, in the Flame in Freefall track, working out of the Alexandria local event, entirely online.",
              )}
            </p>
            <p className="about-meta-line">
              {t("Team")}: Astro-Tech. {t("Challenge")}: {t("Flame in Freefall")}. {t("Local event")}: {t("Alexandria")}. {t("Format")}: {t("Virtual")}.
            </p>

            <div className="role-grid">
              {TEAM.map((m) => (
                <Reveal key={m.name} className="role-card">
                  <span className="ava" aria-hidden="true">
                    {m.init}
                  </span>
                  <div>
                    <h3>{m.name}</h3>
                    <div className="role">{t(m.role)}</div>
                    <p>{t(m.bio)}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="sec alt" id="methods">
          <div className="wrap">
            <h2>{t("From NASA's archive to a cited answer")}</h2>
            <p className="sub">
              {t(
                "Seven steps take a stack of research papers and turn it into an answer you can check. Each step is one person's job.",
              )}
            </p>
            <div className="method-rows">
              {METHODS.map((m) => (
                <Reveal key={m.step} className="method-row">
                  <div className="m-step">{t(m.step)}</div>
                  <p>{t(m.text)}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="sec" id="trust">
          <div className="wrap">
            <h2>{t("Four promises we hold ourselves to")}</h2>
            <ul className="rules-list">
              {RULES.map((r) => (
                <li key={r}>
                  <Icon name="check" size={17} />
                  <span>{t(r)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="sec alt" id="audience">
          <div className="wrap">
            <h2>{t("Who it's for")}</h2>
            <p className="sub">
              {t(
                "LAVA is built for the people the challenge names: the researchers, students and engineers who work with low-gravity combustion data.",
              )}
            </p>
            <div className="role-grid">
              {AUDIENCES.map((a) => (
                <Reveal key={a.who} className="role-card">
                  <span className="ava" aria-hidden="true">
                    <Icon name={a.icon} size={19} />
                  </span>
                  <div>
                    <h3>{t(a.who)}</h3>
                    <p>{t(a.why)}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-band">
          <div className="wrap">
            <h2>{t("Have a look for yourself")}</h2>
            <p>{t("Open the assistant, or browse the papers the team put together.")}</p>
            <div className="cta c">
              <Link className="btn primary lg" to="/chat">
                {t("Open LAVA Intelligence")}
              </Link>
              <Link className="btn light lg" to="/coverage">
                {t("Coverage & Gaps")}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-in">
          <BrandLogo className="brand" />
          <p>{t("Microgravity combustion research over the NASA NTRS corpus.")}</p>
          <nav>
            <Link to="/dashboard">{t("Mission Overview")}</Link>
            <Link to="/coverage">{t("Coverage & Gaps")}</Link>
            <Link to="/chat">{t("LAVA Intelligence")}</Link>
            <Link to="/login">{t("Sign in")}</Link>
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
