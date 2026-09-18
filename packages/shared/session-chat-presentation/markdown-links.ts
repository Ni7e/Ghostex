import { fromMarkdown } from 'mdast-util-from-markdown';
import type { RootContent } from 'mdast';
import { classifySessionChatLinkHref, sessionChatFilePositionFromHref } from './links';
import { sessionChatFilePositionSuffix } from './file-position';
import { sessionChatReferenceKind } from './reference-pills';

export function sessionChatMarkdownLink(href: string, label: string) {
  const target = classifySessionChatLinkHref(href);
  if (target.kind === 'url') {
    return { href, sourceLabel: label, label: label || target.url, title: target.url, kind: 'url' as const };
  }
  return sessionChatMarkdownReference(href, label);
}

export function sessionChatMarkdownReference(href: string, label: string) {
  const target = classifySessionChatLinkHref(href);
  if (target.kind !== 'file') return null;
  const position = sessionChatFilePositionFromHref(href);
  const suffix = sessionChatFilePositionSuffix(position);
  const sourceLabel = label.trim() || target.path;
  return {
    href,
    sourceLabel: label,
    label: suffix && !sourceLabel.endsWith(suffix) ? `${sourceLabel}${suffix}` : sourceLabel,
    title: `${target.path}${suffix}`,
    kind: sessionChatReferenceKind(sourceLabel, target.path),
    path: target.path,
    position,
  };
}

/** Parse once when a message changes, preserving Markdown definitions and escaped destinations. */
export function sessionChatMarkdownReferences(markdown: string) {
  /*
  CDXC:SessionChat 2026-09-18 WHY:
  The full mdast parse ran for every tool output that merely contained a bracket, and it was most of the cost of opening a long transcript in the native runtime.
  A link needs an inline destination `](`, a definition `]:`, or an autolink scheme `<scheme:`; text without any of them cannot carry one, so it skips the parser.
  */
  if (!/\]\(|\]:|<[a-z][a-z0-9+.-]*:/i.test(markdown)) return [];
  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, string>();
  const walk = (nodes: RootContent[], visit: (node: RootContent) => void) => {
    for (const node of nodes) {
      visit(node);
      if ('children' in node) walk(node.children, visit);
    }
  };
  walk(tree.children, (node) => {
    if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  });
  const label = (node: RootContent): string =>
    'value' in node ? node.value : 'children' in node ? node.children.map(label).join('') : '';
  const references: NonNullable<ReturnType<typeof sessionChatMarkdownLink>>[] = [];
  walk(tree.children, (node) => {
    const href =
      node.type === 'link' ? node.url : node.type === 'linkReference' ? definitions.get(node.identifier) : null;
    if (!href) return;
    const reference = sessionChatMarkdownLink(href, label(node));
    if (reference) references.push(reference);
  });
  return references;
}
