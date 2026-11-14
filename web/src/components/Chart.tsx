import { Icon } from "./Icon";

interface ChartProps {
  /** An SVG/HTML string from `lib/chart` (or a backend-rendered SVG). */
  html?: string | null;
  className?: string;
  emptyText?: string;
  /** Show a placeholder while the data is still loading (vs. a true empty state). */
  loading?: boolean;
}

/** Renders the output of the dependency-free chart engine. The builders escape
 *  their own labels, so the string is safe to inject. */
export function Chart({ html, className = "chart-wrap", emptyText = "No chart available", loading = false }: ChartProps) {
  if (!html && loading) {
    return (
      <div className={className}>
        <div className="skel lg" style={{ height: 260, borderRadius: 14 }} />
      </div>
    );
  }
  if (!html) {
    return (
      <div className={className}>
        <div className="empty">
          <Icon name="chart" size={26} />
          <span>{emptyText}</span>
        </div>
      </div>
    );
  }
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
