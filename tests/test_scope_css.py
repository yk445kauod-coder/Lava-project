"""Tests for the per-page CSS scoper (`web/scripts/scope_css.py`).

The scoper rewrites each page's stylesheet so its rules only apply inside that
page's wrapper class. The subtle part is which selector prefixes stay *in front*
of the scope: anything that lives on `<html>` (`:root`, `body`, `[data-theme]`,
`[dir]`) must not be pushed behind the wrapper, or the rule can never match.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("scope_css", ROOT / "web" / "scripts" / "scope_css.py")
scope_css = importlib.util.module_from_spec(_spec)
sys.modules["scope_css"] = scope_css
_spec.loader.exec_module(scope_css)


def scoped(selector: str, scope: str = ".console") -> str:
    dropped: list[str] = []
    return scope_css.scope_selector(selector, scope, dropped)


def test_plain_selector_is_scoped_under_the_wrapper():
    assert scoped(".tbl th") == ".console .tbl th"


def test_root_body_html_prefix_stays_in_front_of_the_scope():
    assert scoped("html body .x") == "html body .console .x"


def test_data_theme_prefix_stays_in_front():
    assert scoped("[data-theme=dark] .card") == "[data-theme=dark] .console .card"


def test_dir_prefix_stays_in_front_so_rtl_rules_can_match():
    # `dir` is set once on <html>; if it were scoped (`.console [dir=rtl] …`) the
    # whole RTL block would be unreachable and Arabic layout would stay LTR.
    assert scoped("[dir=rtl] .tbl th") == "[dir=rtl] .console .tbl th"
    assert scoped("[dir=rtl] .app") == "[dir=rtl] .console .app"


def test_dir_rule_that_is_only_a_global_token_is_dropped():
    # `[dir=rtl] body` has no page-specific class, so global.css owns it.
    dropped: list[str] = []
    assert scope_css.scope_selector("[dir=rtl] body", ".console", dropped) == ""
    assert dropped == ["[dir=rtl] body"]


def test_comma_list_scopes_each_part_independently():
    assert scoped("[dir=rtl] .a, .b") == "[dir=rtl] .console .a, .console .b"


def test_element_level_attribute_is_still_scoped():
    # `[data-mode]` sits on a page element, not <html>, so it stays inside.
    assert scoped("[data-mode=micro] .glow") == ".console [data-mode=micro] .glow"


def test_mobile_rtl_drawer_uses_a_logical_inset_not_a_physical_side():
    """Regression: the mobile RTL drawer opened from the wrong edge.

    `.sidebar` is 280px wide and hidden with `translateX(-100%)`. The RTL
    override used to re-anchor it with physical `left:auto;right:0`, but the
    CSS minifier rewrites that pair to `inset-inline:auto 0`, which under
    `dir=rtl` resolves to `right:auto;left:0` - the opposite edge - so the
    drawer slid in from the left and leaked a strip while closed. Anchor it with
    the logical `inset-inline-start` in the base rule and let RTL inherit that
    edge; the RTL block may then only flip the translate sign.
    """
    css = (ROOT / "web" / "src" / "styles" / "app.css").read_text()
    base_mobile = css.split("@media(max-width:760px){.app{grid-template-columns:1fr}", 1)[1]
    base_sidebar = base_mobile.split(".sidebar{", 1)[1].split("}", 1)[0]
    assert "inset-inline-start:0" in base_sidebar
    assert "left:0" not in base_sidebar

    rtl_mobile = css.split("@media(max-width:760px){[dir=rtl] .sidebar{", 1)[1].split("}", 1)[0]
    assert "transform:translateX(100%)" in rtl_mobile
    assert "left:" not in rtl_mobile and "right:" not in rtl_mobile
