import './projects-loading.css';

/**
 * CDXC:Sidebar 2026-09-14 DECISION:
 * User: show a skeleton until projects have loaded; only show "No Projects Added" once the project inventory is confirmed empty.
 * The initial empty store and gxserver's startup placeholder are both still loading.
 * CDXC:Sidebar 2026-09-16 DECISION:
 * User: add a few more loading bars.
 */
export function SidebarProjectsLoading() {
  return (
    <div className='sidebar-projects-loading' role='status' aria-label='Loading projects' aria-busy='true'>
      {[72, 56, 64, 48, 68, 52, 60].map((width) => (
        <div className='sidebar-projects-loading-row' aria-hidden='true' key={width}>
          <span className='sidebar-projects-loading-icon' />
          <span className='sidebar-projects-loading-title' style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}
