
/** Circular confidence gauge. `value` is a 0..1 fraction. */
export function Ring({ value, title = "confidence" }: { value: unknown; title?: string }) {
  const v = Number(value);
  const p = Number.isFinite(v) ? Math.round(Math.max(0, Math.min(1, v)) * 100) : 0;
  return (
    <span className="ring" style={{ ["--p" as string]: p }} title={title}>
      <span>{p}%</span>
    </span>
  );
}
