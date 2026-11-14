import { esc } from "./format";

/** Inline spans: links, positional citations, bold, italic, mark, code. */
function inline(s: string): string {
  let x = esc(s);
  x = x.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  x = x.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
  );
  x = x.replace(/\[(\d+)\]/g, '<sup class="cite">[$1]</sup>');
  x = x
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:]|$)/g, "$1<i>$2</i>")
    .replace(/==(.+?)==/g, "<mark>$1</mark>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
  return x;
}

/**
 * A small markdown renderer covering what the agent emits: fenced code,
 * `$$` equation blocks, ATX headings (rendered h3-h5), GFM pipe tables,
 * bullet and ordered lists, and paragraphs. Returns an HTML string.
 */
export function markdownToHtml(src: unknown): string {
  const L = String(src ?? "").split("\n");
  let out = "";
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    if (l.startsWith("```")) {
      const c: string[] = [];
      i++;
      while (i < L.length && !L[i].startsWith("```")) c.push(L[i++]);
      i++;
      out += `<pre><code>${esc(c.join("\n"))}</code></pre>`;
      continue;
    }
    if (/^\$\$.+\$\$$/.test(l.trim())) {
      out += `<div class="eq">${esc(l.trim().slice(2, -2).trim())}</div>`;
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      const lvl = Math.min(h[1].length + 2, 5);
      out += `<h${lvl}>${inline(h[2])}</h${lvl}>`;
      i++;
      continue;
    }
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < L.length && L[i].startsWith("|")) {
        rows.push(L[i++].split("|").slice(1, -1).map((c) => c.trim()));
      }
      const head = rows[0] || [];
      const body = rows.slice(2);
      out += `<div class="tbl"><table><thead><tr>${head
        .map((c) => `<th>${inline(c)}</th>`)
        .join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) {
      let it = "";
      while (i < L.length && /^\s*[-*]\s+/.test(L[i])) {
        it += `<li>${inline(L[i++].replace(/^\s*[-*]\s+/, ""))}</li>`;
      }
      out += `<ul>${it}</ul>`;
      continue;
    }
    if (/^\s*\d+\.\s+/.test(l)) {
      let it = "";
      while (i < L.length && /^\s*\d+\.\s+/.test(L[i])) {
        it += `<li>${inline(L[i++].replace(/^\s*\d+\.\s+/, ""))}</li>`;
      }
      out += `<ol>${it}</ol>`;
      continue;
    }
    if (l.trim()) out += `<p>${inline(l)}</p>`;
    i++;
  }
  return out;
}
