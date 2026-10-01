import { Link, NavLink, Outlet, useMatch } from 'react-router';
import { AccountMenu } from './auth/AccountMenu';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { SuggestionBanner } from './fitness-profile/SuggestionBanner';
import { SuggestionProvider } from './fitness-profile/suggestion';
import { WIZARD_PATH } from './pages/WizardPage';

const navItems = [
  { to: '/fitness-profile', label: 'Fitness Profile' },
  { to: '/search-area', label: 'Search Area' },
  { to: '/results', label: 'Results' },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  const base = 'rounded px-3 py-2 text-sm font-medium whitespace-nowrap';
  return isActive
    ? `${base} bg-orange-100 text-orange-800`
    : `${base} text-gray-700 hover:bg-gray-100 hover:text-gray-900`;
}

function Header() {
  const auth = useAuth();
  // The wizard has its own step bar, and a first profile is applied, not suggested.
  const inWizard = useMatch(WIZARD_PATH) !== null;
  const showNav = auth.status === 'signed-in' && !inWizard;

  return (
    <header className="border-b border-gray-200">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link to="/" className="text-xl font-bold text-orange-600">
            myKOM
          </Link>
          {auth.status === 'signed-in' && <AccountMenu me={auth.me} />}
          {auth.status === 'signed-out' && (
            <NavLink to="/login" className={navLinkClass}>
              Log in
            </NavLink>
          )}
        </div>
        {showNav && (
          <nav aria-label="Main">
            <ul className="-mx-3 flex flex-wrap gap-1">
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className={navLinkClass}>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      {showNav && <SuggestionBanner />}
    </header>
  );
}

export function Layout() {
  return (
    <AuthProvider>
      <SuggestionProvider>
        <div className="min-h-screen bg-white text-gray-900">
          <Header />
          <main className="mx-auto max-w-3xl px-4 py-6">
            <Outlet />
          </main>
        </div>
      </SuggestionProvider>
    </AuthProvider>
  );
}
