import { describe, expect, it } from "vitest";

import { AR } from "./dict";
import { translate } from "./translate";

describe("translate", () => {
  it("returns the source string unchanged for English", () => {
    expect(translate("en", {}, "Mission Overview")).toBe("Mission Overview");
  });
  it("uses the bundled Arabic dictionary", () => {
    expect(translate("ar", {}, "Mission Overview")).toBe(AR["Mission Overview"]);
  });
  it("prefers the machine cache over the source string", () => {
    expect(translate("fr", { Hello: "Bonjour" }, "Hello")).toBe("Bonjour");
  });
  it("falls back to the source string when nothing is known", () => {
    expect(translate("fr", {}, "Hello")).toBe("Hello");
  });
  it("returns an empty string unchanged", () => {
    expect(translate("ar", {}, "")).toBe("");
  });
});

describe("Arabic dictionary", () => {
  it("covers the shell vocabulary", () => {
    expect(Object.keys(AR).length).toBeGreaterThan(400);
    expect(AR["LAVA Intelligence"]).toBeTruthy();
    expect(AR["Coverage & Gaps"]).toBeTruthy();
  });
});
