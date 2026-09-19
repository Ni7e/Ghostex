/**
 * CommonMark rejects spaces in bare link destinations, while composer image
 * references deliberately carry literal machine paths. Turn only those image
 * references into link nodes so they keep their exact authored position and
 * reach the chat image-preview renderer even when the path contains spaces.
 */

interface MarkdownNode {
  children?: MarkdownNode[];
  type?: string;
  url?: string;
  value?: unknown;
}

const IMAGE_REFERENCE = /\[Image #(\d+)\]\(([^)\r\n]+)\)/g;

/**
 * The text a node was written as, when it was written as plain prose. GFM
 * links an email-, www- or http-shaped fragment of that prose on its own (a
 * retina screenshot named `shot@2x.png` reads as an email address), which
 * splits a spaced reference across nodes, so those links count as prose here.
 */
function proseText(node: MarkdownNode): string | null {
  if (node.type === 'text') return typeof node.value === 'string' ? node.value : null;
  const child = node.children?.length === 1 ? node.children[0] : undefined;
  if (node.type !== 'link' || child?.type !== 'text' || typeof child.value !== 'string') return null;
  const value = child.value;
  return node.url === value || node.url === `mailto:${value}` || node.url === `http://${value}` ? value : null;
}

/** One run of adjacent prose nodes, with every image reference in it made a link. */
function linkImageReferences(run: MarkdownNode[]): MarkdownNode[] {
  const texts = run.map((node) => proseText(node) ?? '');
  const prose = texts.join('');
  const references = [...prose.matchAll(IMAGE_REFERENCE)];
  if (references.length === 0) return run;
  const linked: MarkdownNode[] = [];
  // The prose between references keeps its nodes, except where a reference cuts one.
  const keep = (from: number, to: number): void => {
    let offset = 0;
    run.forEach((node, index) => {
      const start = offset;
      const end = start + (texts[index]?.length ?? 0);
      offset = end;
      if (end <= from || start >= to) return;
      linked.push(
        start >= from && end <= to
          ? node
          : { type: 'text', value: prose.slice(Math.max(start, from), Math.min(end, to)) }
      );
    });
  };
  let cursor = 0;
  for (const match of references) {
    keep(cursor, match.index);
    linked.push({
      children: [{ type: 'text', value: `Image #${match[1]}` }],
      type: 'link',
      url: match[2]?.trim() ?? '',
    });
    cursor = match.index + match[0].length;
  }
  keep(cursor, prose.length);
  return linked;
}

export function remarkSessionChatImageReferences() {
  return (tree: MarkdownNode): void => {
    const visit = (node: MarkdownNode): void => {
      if (!node.children) {
        return;
      }
      const children: MarkdownNode[] = [];
      let run: MarkdownNode[] = [];
      for (const child of node.children) {
        if (proseText(child) !== null) {
          run.push(child);
          continue;
        }
        children.push(...linkImageReferences(run));
        run = [];
        visit(child);
        children.push(child);
      }
      children.push(...linkImageReferences(run));
      node.children = children;
    };
    visit(tree);
  };
}
