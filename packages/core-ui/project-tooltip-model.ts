import type { SidebarProjectDiffStats } from '@/packages/shared/project-diff-stats';

export function formatProjectEditorLineCount(lines: number): string {
  return String(Math.min(9999, Math.max(0, lines)));
}

export function formatProjectTooltipGitStats(stats: SidebarProjectDiffStats): string {
  if (stats.isLoading) {
    return 'Git: loading changes';
  }

  if (!stats.isRepo) {
    return 'Git: not a repository';
  }

  const fileCount = Math.max(0, stats.files);
  const changedLineCount = Math.max(0, stats.additions) + Math.max(0, stats.deletions);
  /**
   * CDXC:Git 2026-06-14-16:33:
   * Project and worktree title tooltips should spell out the file and line
   * nouns so one changed file or one changed line reads as singular while the
   * compact inline diff badge can remain numeric-only.
   */
  return `${fileCount} ${formatCountLabel(fileCount, 'file')} changed  +${formatProjectEditorLineCount(
    stats.additions
  )}  -${formatProjectEditorLineCount(stats.deletions)} ${formatCountLabel(changedLineCount, 'line')}`;
}

export function formatCountLabel(count: number, singular: string): string {
  return Math.abs(count) === 1 ? singular : `${singular}s`;
}
