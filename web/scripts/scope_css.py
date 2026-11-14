"""Scope a stylesheet's selectors under a page-root selector and rename its
keyframes, so several page stylesheets can coexist in one SPA bundle.

Usage: python3 scripts/scope_css.py <src> <scope> <out> <prefix>
"""
import re
import sys

OPEN_AT = ("@media", "@supports", "@container", "@layer")


def split_top(body):
    items, i, n = [], 0, len(body)
    while i < n:
        while i < n and body[i] in " \t\r\n":
            i += 1
        if i < n and body[i:i + 2] == "/*":
            j = body.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if i >= n:
            break
        j = body.find("{", i)
        if j < 0:
            items.append(body[i:])
            break
        prelude = body[i:j]
        semi = body.find(";", i)
        if semi != -1 and semi < j:
            items.append(body[i:semi + 1])
            i = semi + 1
            continue
        depth, k = 1, j + 1
        while k < n and depth:
            if body[k] == "{":
                depth += 1
            elif body[k] == "}":
                depth -= 1
            k += 1
        items.append((prelude.strip(), body[j + 1:k - 1]))
        i = k
    return items


GLOBAL_TOKENS = {"html", "body", ":root", "*"}


def _is_global_prefix(tok):
    t = tok.lower()
    return t in GLOBAL_TOKENS or t.startswith("[data-theme")


def scope_selector(sel, scope, dropped):
    """Scope a selector under `scope`. A leading run of html/:root/body/
    [data-theme] tokens stays in front of the scope (they live on <html>); a
    selector that is *only* such tokens is a global rule and is dropped, since
    tokens.css/global.css own those."""
    parts = []
    for part in sel.split(","):
        p = part.strip()
        if not p:
            continue
        toks = p.split()
        lead = []
        while toks and _is_global_prefix(toks[0]):
            lead.append(toks.pop(0))
        if not toks:
            dropped.append(p)
            continue
        prefix = " ".join(lead)
        rest = " ".join(toks)
        parts.append(f"{prefix} {scope} {rest}".strip() if prefix else f"{scope} {rest}")
    return ", ".join(parts)


def rename_animation_refs(inner, rename):
    """Rewrite `animation`/`animation-name` declarations to the renamed keyframes.

    The shorthand holds the animation name among durations, easings and delays,
    so the name is matched as a whole word rather than by position."""
    if not rename:
        return inner
    out = []
    for decl in inner.split(";"):
        m = re.match(r"\s*(animation(?:-name)?)\s*:\s*(.*)", decl, re.S)
        if m:
            prop, val = m.group(1), m.group(2)
            val = re.sub(r"\b[A-Za-z_][\w-]*\b", lambda t: rename.get(t.group(0), t.group(0)), val)
            out.append(f"{prop}:{val}")
        else:
            out.append(decl)
    return ";".join(out)


def process(body, scope, rename, dropped):
    out = []
    for item in split_top(body):
        if isinstance(item, str):
            out.append(item)
            continue
        prelude, inner = item
        low = prelude.lower()
        if low.startswith(OPEN_AT):
            nested = process(inner, scope, rename, dropped)
            if nested.strip():
                out.append(f"{prelude}{{\n{nested}\n}}")
        elif low.startswith("@keyframes"):
            name = prelude.split(None, 1)[1].strip()
            out.append(f"@keyframes {rename.get(name, name)}{{{inner}}}")
        elif low.startswith(("@font-face", "@property", "@page")):
            out.append(f"{prelude}{{{inner}}}")
        else:
            scoped = scope_selector(prelude, scope, dropped)
            if scoped:
                out.append(f"{scoped}{{{rename_animation_refs(inner, rename)}}}")
    return "\n".join(out)


def collect_keyframes(body):
    names = []
    for item in split_top(body):
        if isinstance(item, tuple):
            prelude, inner = item
            low = prelude.lower()
            if low.startswith("@keyframes"):
                names.append(prelude.split(None, 1)[1].strip())
            elif low.startswith(OPEN_AT):
                names += collect_keyframes(inner)
    return names


def main():
    src, scope, out_path, prefix = sys.argv[1:5]
    body = open(src).read()
    names = set(collect_keyframes(body))
    rename = {n: f"{prefix}-{n}" for n in names}
    dropped = []
    result = process(body, scope, rename, dropped)
    open(out_path, "w").write(result + "\n")
    print(f"{src}: scoped under {scope}, {len(names)} keyframes renamed, "
          f"{len(dropped)} global selectors dropped: {sorted(set(dropped))}")


if __name__ == "__main__":
    main()
