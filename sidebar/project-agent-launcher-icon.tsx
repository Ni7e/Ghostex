import { IconCode } from "@tabler/icons-react";
import type { SidebarAgentButton } from "../shared/sidebar-agents";
import { AGENT_LOGO_COLORS, AGENT_LOGOS } from "./agent-logos";

export function ProjectAgentLauncherIcon({
  agent,
  colorMode = "monochrome",
}: {
  agent?: SidebarAgentButton;
  colorMode?: "brand" | "monochrome";
}) {
  if (!agent) {
    return (
      <IconCode
        aria-hidden="true"
        className="group-agent-launcher-icon group-agent-launcher-tabler-icon"
        size={14}
        stroke={1.9}
      />
    );
  }

  if (agent.icon) {
    /**
     * CDXC:ProjectAgents 2026-05-16-18:21:
     * The sidebar project agent dropdown should show colored provider icons for
     * scanability, while compact split launchers stay monochrome unless the
     * caller opts into brand color.
     *
     * CDXC:ProjectAgents 2026-06-30-22:40:
     * The Settings toggle for colored agent icons also applies to the compact
     * selected-agent launcher icon, so colorMode must stay explicit at the
     * launcher call site instead of being limited to dropdown rows.
     */
    const iconColor = colorMode === "brand" ? AGENT_LOGO_COLORS[agent.icon] : "currentColor";

    return (
      <span
        aria-hidden="true"
        className="group-agent-launcher-icon group-agent-launcher-agent-icon"
        data-agent-icon={agent.icon}
        style={{
          backgroundColor: iconColor,
          maskImage: `url("${AGENT_LOGOS[agent.icon]}")`,
          WebkitMaskImage: `url("${AGENT_LOGOS[agent.icon]}")`,
        }}
      />
    );
  }

  return (
    <IconCode
      aria-hidden="true"
      className="group-agent-launcher-icon group-agent-launcher-tabler-icon"
      size={14}
      stroke={1.9}
    />
  );
}
