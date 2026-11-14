"""Bundle the per-locale UI dictionaries into the web app.

The dashboard ships English as its source language and Arabic as a hand-written
override in `web/src/lib/i18n/dict.ts`. The remaining locales are produced here
from `scripts/i18n_locales.json`, a checked-in snapshot of the curated
translations, so the app renders every locale from the bundle instead of asking
the worker to machine-translate on first paint.

Run after editing the snapshot:

    python3 scripts/build_locales.py

Each locale becomes `web/src/lib/i18n/locales/<code>.ts` exporting a single
`Record<string, string>`, and `web/src/lib/i18n/dict.ts` re-exports them so the
provider has one import.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = ROOT / "scripts" / "i18n_locales.json"
OUT_DIR = ROOT / "web" / "src" / "lib" / "i18n" / "locales"

# English is the source language and Arabic is authored by hand in dict.ts.
SKIP = {"en", "ar"}


def ts_literal(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def main() -> int:
    data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    for code in sorted(data):
        if code in SKIP:
            continue
        table = {k: v for k, v in data[code].items() if k and v and v != k}
        lines = [
            f"/* {code} UI strings, keyed by the English source. Rebuilt from",
            "   scripts/build_locales.py from scripts/i18n_locales.json - edit the",
            "   snapshot, not this file. */",
            f"export const {code.upper()}: Record<string, string> = {{",
        ]
        for src in sorted(table):
            lines.append(f"  {ts_literal(src)}: {ts_literal(table[src])},")
        lines.append("};")
        (OUT_DIR / f"{code}.ts").write_text("\n".join(lines) + "\n", encoding="utf-8")
        index.append((code, len(table)))
    print("wrote:", ", ".join(f"{c}={n}" for c, n in index))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
