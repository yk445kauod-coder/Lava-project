"""Contract tests for the mobile off-canvas drawer.

Two classes of bug shipped here and are worth pinning with a test:

* **Stacking.** The drawer is `position: fixed`, the bottom navbar is too, and
  the scrim sits between them. When the bar's z-index was above the drawer's,
  the bar covered the drawer footer - the sign-out button and the last nav link
  received clicks meant for the navbar. The order must be
  botnav < scrim < drawer < sheet.
* **RTL anchoring.** The drawer must sit against the inline-start edge, which is
  the right edge in RTL. Anchoring it with a physical side, or hiding it with a
  translate of the wrong sign, either leaves a strip of the panel on screen while
  closed or opens it from the wrong edge.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_CSS = (ROOT / "web" / "src" / "styles" / "app.css").read_text()
TOKENS_CSS = (ROOT / "web" / "src" / "styles" / "tokens.css").read_text()
GLOBAL_CSS = (ROOT / "web" / "src" / "styles" / "global.css").read_text()


def _z(name: str) -> int:
    m = re.search(rf"--{name}:\s*(\d+)", TOKENS_CSS)
    assert m, f"--{name} not declared in tokens.css"
    return int(m.group(1))


def test_drawer_stacks_above_the_bottom_navbar():
    # The bar used to win, which made the drawer footer (sign-out) unclickable.
    assert _z("z-botnav") < _z("z-scrim") < _z("z-drawer") < _z("z-sheet")


def test_chrome_layers_reference_the_tokens():
    assert re.search(r"z-index:\s*var\(--z-drawer\)", APP_CSS)
    assert re.search(r"z-index:\s*var\(--z-scrim\)", APP_CSS)
    assert re.search(r"z-index:\s*var\(--z-botnav\)", GLOBAL_CSS)
    assert re.search(r"z-index:\s*var\(--z-sheet\)", GLOBAL_CSS)
    # the mobile drawer rule must not carry a hard-coded z-index
    mobile_block = APP_CSS.split("@media(max-width:760px){.app{grid-template-columns:1fr}", 1)[1]
    sidebar_rule = mobile_block.split(".sidebar{", 1)[1].split("}", 1)[0]
    assert "z-index:var(--z-drawer)" in sidebar_rule


def test_mobile_drawer_anchors_to_the_inline_start_edge():
    # Physical left/right is rewritten to logical by the minifier and can resolve
    # to the wrong edge under dir=rtl; the writing-mode-relative inset cannot.
    mobile_block = APP_CSS.split("@media(max-width:760px){.app{grid-template-columns:1fr}", 1)[1]
    sidebar_rule = mobile_block.split(".sidebar{", 1)[1].split("}", 1)[0]
    assert "inset-inline-start:0" in sidebar_rule
    assert "left:0" not in sidebar_rule
    assert "translateX(-100%)" in sidebar_rule


def test_desktop_rtl_does_not_override_the_grid_template():
    """Regression: the docked sidebar sat on the wrong side in Arabic.

    A CSS grid mirrors under `dir=rtl` on its own - column 1 lands on the
    inline-start edge, which is the right. Hand-written RTL overrides
    (`[dir=rtl] .app{grid-template-columns:...}` plus `[dir=rtl] .sidebar{order:2}`)
    cancelled that, so the docked sidebar rendered on the left while the mobile
    drawer opened from the right, and the chat template collapsed the sidebar to
    0px whenever the research panel was closed.
    """
    for name in ("app.css", "styles.css"):
        css = (ROOT / "web" / "src" / "styles" / name).read_text()
        # an RTL template that pins a fixed-width column is the bug; collapsing to
        # a single column on mobile is legitimate.
        assert not re.search(r"\[dir=rtl\][^{]*\{[^}]*grid-template-columns:[^;}]*\d+px", css), name
        assert not re.search(r"\[dir=rtl\] \.sidebar\{[^}]*order:", css), name


def test_drawer_breakpoint_matches_the_css():
    # The CSS drawer breakpoint and the JS media query must agree, or the drawer
    # is off-canvas in one and docked in the other.
    assert "@media(max-width:760px)" in APP_CSS
    hook = (ROOT / "web" / "src" / "lib" / "useMobileDrawer.ts").read_text()
    assert '(max-width: 760px)' in hook
    assert 'min-width: 761px' in hook


def test_rtl_only_flips_the_translate_sign():
    # RTL must not re-anchor the panel; it inherits the inline-start edge and
    # only moves off the opposite side.
    rtl_block = APP_CSS.split("@media(max-width:760px){[dir=rtl] .sidebar{", 1)[1].split("}", 1)[0]
    assert "transform:translateX(100%)" in rtl_block
    assert "left:" not in rtl_block and "right:" not in rtl_block
