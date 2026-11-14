export interface NavItem {
  id: string;
  href: string;
  icon: string;
  label: string;
}
export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** One navigation model shared by the sidebar and the route table.
 *  Labels describe what the user does (task-oriented), and the order follows the
 *  task flow: Overview → Experiments → Measurements → Coverage → Evidence. */
export const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { id: "mission", href: "/dashboard", icon: "grid", label: "Mission Overview" },
    ],
  },
  {
    group: "Evidence",
    items: [
      { id: "experiments", href: "/experiments", icon: "flask", label: "Experiments" },
      { id: "data", href: "/datasets", icon: "chart", label: "Measurements & Data" },
      { id: "coverage", href: "/coverage", icon: "shield", label: "Coverage & Gaps" },
      { id: "explorer", href: "/explorer", icon: "book", label: "Source Documents" },
    ],
  },
  {
    group: "Analysis",
    items: [
      { id: "chat", href: "/chat", icon: "comments", label: "LAVA Intelligence" },
      { id: "reports", href: "/reports", icon: "file", label: "Research Briefs" },
      { id: "relevance", href: "/relevance", icon: "telescope", label: "Mission Relevance" },
      { id: "modeling", href: "/modeling", icon: "activity", label: "Predictive Modeling" },
      { id: "safety", href: "/safety", icon: "layers", label: "Fire Safety Systems" },
      { id: "insights", href: "/insights", icon: "bolt", label: "Fire-Safety Insights" },
      { id: "rank", href: "/rank", icon: "rank", label: "Smart Ranking" },
      { id: "compare", href: "/compare", icon: "compare", label: "Comparative Analysis" },
    ],
  },
  {
    group: "Project",
    items: [{ id: "about", href: "/about", icon: "compass", label: "About & Team" }],
  },
];
