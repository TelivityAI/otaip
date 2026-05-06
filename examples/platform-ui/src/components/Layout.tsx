import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Dashboard', match: 'exact' as const },
  { to: '/playground', label: 'Playground', match: 'prefix' as const },
];

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Dark sidebar */}
      <aside className="w-56 shrink-0 bg-slate-900 text-slate-100">
        <div className="px-5 py-6">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span className="text-sm font-semibold tracking-wide">OTAIP</span>
          </div>
          <div className="mt-1 text-xs text-slate-400">Platform</div>
        </div>
        <nav className="px-3">
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.match === 'exact'}
                  className={({ isActive }) =>
                    [
                      'block rounded-md px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                    ].join(' ')
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="absolute bottom-0 w-56 border-t border-slate-800 px-5 py-3 text-[11px] text-slate-500">
          Local dev tool · no auth
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
