import { markdownToHtml } from "../lib/markdown";

/** Renders the agent's markdown (headings, tables, lists, citations). The
 *  renderer escapes its own input, so the string is safe to inject. */
export function Markdown({ html, className = "md" }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: markdownToHtml(html) }} />;
}
