import type { Element, Root, RootContent } from 'hast';

const HEX_COLOR = /(?<![\w/#])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w/-])/gi;

/**
 * CDXC:SessionChat 2026-09-15 DECISION:
 * User: show a small rounded square beside each color in shared desktop, mobile, and web chat messages.
 */
export function rehypeSessionChatColorSwatches() {
  return (tree: Root): void => {
    const visit = (node: Root | Element): void => {
      if (node.type === 'element' && ['pre', 'a', 'script', 'style'].includes(node.tagName)) return;
      node.children = node.children.flatMap((child): RootContent[] => {
        if (child.type === 'element') {
          visit(child);
          return [child];
        }
        if (child.type !== 'text') return [child];

        const children: RootContent[] = [];
        let cursor = 0;
        for (const match of child.value.matchAll(HEX_COLOR)) {
          if (match.index > cursor) children.push({ type: 'text', value: child.value.slice(cursor, match.index) });
          children.push({
            type: 'element',
            tagName: 'span',
            properties: { className: ['ghostex-chat-color'] },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: {
                  ariaHidden: 'true',
                  className: ['ghostex-chat-color-swatch'],
                  style: `background-color: ${match[0]}`,
                },
                children: [],
              },
              { type: 'text', value: match[0] },
            ],
          });
          cursor = match.index + match[0].length;
        }
        if (cursor === 0) return [child];
        if (cursor < child.value.length) children.push({ type: 'text', value: child.value.slice(cursor) });
        return children;
      });
    };
    visit(tree);
  };
}
