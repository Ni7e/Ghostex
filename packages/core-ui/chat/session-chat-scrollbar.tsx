import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useAppScrollbars } from '@/packages/components/ui/app-scrollbars';
import './session-chat-scrollbar.css';

/** CDXC:SessionChat 2026-09-16 DECISION:
 * User: keep one transcript scrollbar with the shared app colors and hover reveal, superseding the earlier transcript scroll-only reveal. The chat input retains its scroll-only reveal.
 */
export function SessionChatScrollbar({
  viewportRef,
  contentRef,
  onNavigate,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  onNavigate: () => void;
}) {
  useAppScrollbars();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ y: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!viewport || !content || !track || !thumb) return;
    const measure = () => {
      const range = viewport.scrollHeight - viewport.clientHeight;
      const height = Math.min(
        track.clientHeight,
        Math.max(24, (viewport.clientHeight / viewport.scrollHeight) * track.clientHeight)
      );
      const progress = range > 0 ? Math.max(0, Math.min(1, viewport.scrollTop / range)) : 0;
      thumb.style.height = `${height}px`;
      thumb.style.transform = `translateY(${progress * (track.clientHeight - height)}px)`;
      track.hidden = range <= 0;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    observer.observe(track);
    viewport.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', measure);
    };
  }, [contentRef, viewportRef]);

  return (
    <div aria-hidden='true' className='ghostex-chat-scrollbar' ref={trackRef}>
      <div
        className='ghostex-chat-scrollbar-thumb'
        ref={thumbRef}
        onPointerDown={(event) => {
          const viewport = viewportRef.current;
          if (event.button !== 0 || !viewport) return;
          event.preventDefault();
          onNavigate();
          dragRef.current = { y: event.clientY, top: viewport.scrollTop };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.dataset.dragging = 'true';
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          const viewport = viewportRef.current;
          const track = trackRef.current;
          if (!drag || !viewport || !track) return;
          const travel = track.clientHeight - event.currentTarget.clientHeight;
          if (travel > 0)
            viewport.scrollTop =
              drag.top + ((event.clientY - drag.y) / travel) * (viewport.scrollHeight - viewport.clientHeight);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={(event) => {
          dragRef.current = null;
          delete event.currentTarget.dataset.dragging;
        }}
      />
    </div>
  );
}
