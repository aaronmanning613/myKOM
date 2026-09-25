import { Navigate, Outlet } from 'react-router';
import { useAuth } from './AuthContext';

/** Wraps routes that need a signed-in Runner; sends signed-out visitors to `/login`. */
export function RequireAuth() {
  const auth = useAuth();
  if (auth.status === 'loading') return <p className="text-gray-500">Loading…</p>;
  if (auth.status === 'signed-out') return <Navigate to="/login" replace />;
  return <Outlet />;
}
