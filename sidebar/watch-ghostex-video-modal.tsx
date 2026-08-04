import { useId } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SidebarTheme } from "../shared/session-grid-contract";

export type WatchGhostexVideoModalProps = {
  isOpen: boolean;
  onClose: () => void;
  theme?: SidebarTheme;
};

const WATCH_GHOSTEX_VIDEO_TITLE =
  "Ghostex Features Walkthrough";
const WATCH_GHOSTEX_VIDEO_SOURCE_URL =
  "https://www.loom.com/share/84a08f60871a4c57a589c057335ac25b";
const WATCH_GHOSTEX_VIDEO_EMBED_URL =
  "https://www.loom.com/embed/84a08f60871a4c57a589c057335ac25b?hideEmbedTopBar=true";

/*
 * CDXC:GhostexTutorialVideo 2026-06-18-04:49:
 * The tutorial video modal is a direct copy of the Highlighted Features modal shell, but it must show one page only: the supplied walkthrough video.
 * Keep disabled outside-click dismissal and the first-launch dialog surface so
 * the tutorial behaves like the existing replayable feature modal.
 *
 * CDXC:GhostexTutorialVideo 2026-06-18-05:35:
 * Third-party video embeds can reject playback from WKWebView documents without a valid HTTP referrer. Keep the iframe referrer policy aligned with the native modal-host HTTPS base URL for this video-only modal.
 *
 * CDXC:GhostexTutorialVideo 2026-06-18-05:49:
 * The tutorial content uses an editable Loom embed. Keep the iframe source as
 * a single constant so the embed can be replaced later without reworking the
 * modal layout.
 *
 * CDXC:GhostexTutorialVideo 2026-08-03:
 * The native child-window title is the tutorial surface's one visible heading.
 * Do not repeat it in the video body or in Loom's embed top bar.
 */

export function WatchGhostexVideoModal({
  isOpen,
  onClose,
  theme = "dark-blue",
}: WatchGhostexVideoModalProps) {
  const titleId = useId();

  return (
    <Dialog
      disablePointerDismissal
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        aria-labelledby={titleId}
        className={cn(
          "ghostex-settings-shadcn settings-modal-dialog first-launch-setup-modal-dialog discover-ghostex-modal-dialog watch-ghostex-video-modal-dialog flex flex-col gap-0 overflow-hidden p-0 font-sans",
          getSidebarThemeVariant(theme) === "dark" && "dark",
        )}
        data-sidebar-theme={theme}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle id={titleId}>{WATCH_GHOSTEX_VIDEO_TITLE}</DialogTitle>
        </DialogHeader>
        <div className="discover-ghostex-body watch-ghostex-video-body">
          <section
            aria-label={WATCH_GHOSTEX_VIDEO_TITLE}
            className="discover-ghostex-feature-stage watch-ghostex-video-stage"
            id="watch-ghostex-video-panel"
          >
            <div className="discover-ghostex-feature-visual watch-ghostex-video-visual">
              <iframe
                allow="fullscreen; picture-in-picture"
                allowFullScreen
                className="watch-ghostex-video-frame"
                data-source-url={WATCH_GHOSTEX_VIDEO_SOURCE_URL}
                frameBorder="0"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                src={WATCH_GHOSTEX_VIDEO_EMBED_URL}
                title="Ghostty tutorial video"
              />
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getSidebarThemeVariant(theme: SidebarTheme): "dark" | "light" {
  return theme.startsWith("light-") || theme === "plain-light" ? "light" : "dark";
}
