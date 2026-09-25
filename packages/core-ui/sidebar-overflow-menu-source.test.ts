import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const recentProjectsModalSource = readFileSync(new URL('./recent-projects-modal.tsx', import.meta.url), 'utf8');
const groupPanelsCssSource = readFileSync(new URL('./styles/group-panels.css', import.meta.url), 'utf8');

describe('recent projects source', () => {
  test('renders recent project rows in the modal', () => {
    expect(recentProjectsModalSource).toContain('export function RecentProjectRow(');
    expect(recentProjectsModalSource).toContain('{project.title}');
    expect(recentProjectsModalSource).toContain('{project.path}');
    expect(recentProjectsModalSource).toContain('{project.sessionCount}');
    expect(groupPanelsCssSource).toContain('.recent-projects-section');
    expect(groupPanelsCssSource).not.toContain('.recent-projects-drawer');
  });
});
