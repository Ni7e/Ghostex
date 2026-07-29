import { IconChevronDown } from "@tabler/icons-react";
import type { ReactNode } from "react";

/*
 * CDXC:SidebarV2 2026-07-29:
 * Settled and Snoozed are shelves, not filters: they park rows out of the
 * inbox without deleting them. Ported from t3code's shelf header, including
 * two rules that are easy to lose in a port:
 *
 * - The count shows ONLY while collapsed. Expanded, the visible rows are the
 *   count, and repeating it just adds noise to the header.
 * - Collapsing UNMOUNTS the rows instead of animating a height. A shelf can
 *   hold hundreds of settled sessions; keeping them mounted behind a collapsed
 *   header would keep paying their layout cost for nothing.
 */

export type SidebarV2ShelfTone = "browser" | "settled" | "snoozed";

export type SidebarV2ShelfProps = {
  children: ReactNode;
  count: number;
  isExpanded: boolean;
  label: string;
  onToggle: () => void;
  tone: SidebarV2ShelfTone;
};

export function SidebarV2Shelf({
  children,
  count,
  isExpanded,
  label,
  onToggle,
  tone,
}: SidebarV2ShelfProps) {
  if (count === 0) {
    return null;
  }
  return (
    <>
      <li className="sidebar-v2-shelf-header-item">
        <button
          aria-expanded={isExpanded}
          className="sidebar-v2-shelf-header"
          data-tone={tone}
          onClick={onToggle}
          type="button"
        >
          <span className="sidebar-v2-shelf-label">
            {isExpanded ? label : `${label} (${count})`}
          </span>
          <span aria-hidden="true" className="sidebar-v2-shelf-rule" />
          <IconChevronDown
            aria-hidden="true"
            className="sidebar-v2-shelf-chevron"
            data-expanded={String(isExpanded)}
            size={12}
            stroke={2}
          />
        </button>
      </li>
      {isExpanded ? children : null}
    </>
  );
}
