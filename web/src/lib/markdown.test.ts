import { describe, expect, it } from "vitest";

import { markdownToHtml } from "./markdown";

describe("markdownToHtml", () => {
  it("turns [n] markers into positional citation superscripts", () => {
    expect(markdownToHtml("Flames spread [2] slowly.")).toContain('<sup class="cite">[2]</sup>');
  });

  it("renders a GFM pipe table with a header row", () => {
    const html = markdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("escapes raw HTML so corpus text cannot inject markup", () => {
    expect(markdownToHtml("<script>x</script>")).toContain("&lt;script&gt;");
  });

  it("renders bold, italic and code spans", () => {
    const html = markdownToHtml("**b** *i* `c`");
    expect(html).toContain("<b>b</b>");
    expect(html).toContain("<i>i</i>");
    expect(html).toContain("<code>c</code>");
  });
});
