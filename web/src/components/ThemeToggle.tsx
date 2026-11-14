import { useTheme } from "../lib/useTheme";
import { useI18n } from "../lib/i18n/provider";
import { Icon } from "./Icon";

/** Sun/moon toggle. Both glyphs are stacked; CSS cross-fades them on
 *  `[data-theme]`, so the button never changes size. */
export function ThemeToggle() {
  const { toggle } = useTheme();
  const { t } = useI18n();
  return (
    <button className="icon-btn theme-toggle" type="button" aria-label={t("Toggle theme")} onClick={toggle}>
      <i className="theme-sun">
        <Icon name="sun" size={19} />
      </i>
      <i className="theme-moon">
        <Icon name="moon" size={19} />
      </i>
    </button>
  );
}
