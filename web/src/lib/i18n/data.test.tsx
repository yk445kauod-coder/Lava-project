import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "./provider";
import { useTranslated, useTranslatedClamped } from "./data";

function Probe({ mode, values, n }: { mode: "raw" | "clamped"; values: string[]; n: number }) {
  const out = mode === "clamped" ? useTranslatedClamped(values, n) : useTranslated(values);
  return <span>{out.join("|")}</span>;
}

describe("useTranslatedClamped", () => {
  it("truncates a value for display", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <Probe mode="clamped" values={["a".repeat(50)]} n={10} />
      </I18nProvider>,
    );
    expect(html).toContain("a".repeat(10) + "...");
  });

  it("keeps short values intact", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <Probe mode="clamped" values={["short"]} n={42} />
      </I18nProvider>,
    );
    expect(html).toContain("short");
  });

  it("passes through a null value untouched", () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <Probe mode="raw" values={[null as unknown as string]} n={0} />
      </I18nProvider>,
    );
    expect(html).not.toContain("null");
  });
});
