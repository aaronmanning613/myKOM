import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { HealthStatusPanel } from './HealthStatusPanel';
import { WIZARD_PATH } from './WizardPage';

/** `/`: the wizard for a Runner who isn't onboarded, Results for the rest, else the home page. */
export function Home() {
  const auth = useAuth();
  if (auth.status === 'loading') return <p className="text-gray-500">Loading…</p>;
  if (auth.status === 'signed-in') {
    return <Navigate to={auth.me.onboarded ? '/results' : WIZARD_PATH} replace />;
  }
  return <HomePage />;
}

export function HomePage() {
  return (
    <>
      <h1 className="text-3xl font-bold text-orange-600">myKOM</h1>
      <p className="mt-2 text-gray-700">
        Find the Segments near you whose record you could realistically take.
      </p>
      <HealthStatusPanel />
    </>
  );
}
