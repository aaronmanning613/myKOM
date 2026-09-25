import { Link, NavLink, Outlet } from 'react-router';

const navItems = [
  { to: '/fitness-profile', label: 'Fitness Profile' },
  { to: '/search-area', label: 'Search Area' },
  { to: '/results', label: 'Results' },
  { to: '/login', label: 'Log in' },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  const base = 'rounded px-3 py-2 text-sm font-medium whitespace-nowrap';
  return isActive
    ? `${base} bg-orange-100 text-orange-800`
    : `${base} text-gray-700 hover:bg-gray-100 hover:text-gray-900`;
}

export function Layout() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/" className="text-xl font-bold text-orange-600">
            myKOM
          </Link>
          <nav aria-label="Main">
            <ul className="-mx-3 flex flex-wrap gap-1 sm:mx-0">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className={navLinkClass}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
