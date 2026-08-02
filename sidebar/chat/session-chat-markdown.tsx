// Markdown body for chat bubbles: react-markdown + remark-gfm (per the
// client-integration map both are in the root package.json for this purpose).
// Links and inline images that point at image files open in the chat's
// centered image overlay instead of navigating the page (the destinations are
// usually machine paths from "[Image #N](path)" references, which a browser
// cannot open as URLs anyway).

import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  isSessionChatImageHref,
  sessionChatImageTargetForHref,
  useSessionChatImageViewer,
  type SessionChatImageViewerApi,
} from "./session-chat-image-viewer";

const REMARK_PLUGINS = [remarkGfm];

function imageOverlayComponents(viewer: SessionChatImageViewerApi): Components {
  return {
    a: ({ children, href }) => {
      if (typeof href === "string" && isSessionChatImageHref(href)) {
        const target = sessionChatImageTargetForHref(href);
        if (viewer.canOpen(target)) {
          return (
            <button
              className="ghostex-chat-image-link"
              onClick={() => viewer.open(target)}
              type="button"
            >
              {children}
            </button>
          );
        }
      }
      return (
        <a href={href} rel="noreferrer" target="_blank">
          {children}
        </a>
      );
    },
    img: ({ alt, src }) => {
      if (typeof src === "string" && src !== "") {
        const target = {
          ...sessionChatImageTargetForHref(src),
          ...(alt ? { alt } : {}),
        };
        if (viewer.canOpen(target)) {
          return (
            <button
              className="ghostex-chat-image-link"
              onClick={() => viewer.open(target)}
              type="button"
            >
              {alt || "Image"}
            </button>
          );
        }
      }
      return <img alt={alt ?? ""} src={src ?? ""} />;
    },
  };
}

export function SessionChatMarkdown({ markdown }: { markdown: string }) {
  const viewer = useSessionChatImageViewer();
  const components = useMemo(
    () => (viewer ? imageOverlayComponents(viewer) : undefined),
    [viewer],
  );
  return (
    <div className="ghostex-chat-markdown">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        {...(components ? { components } : {})}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
