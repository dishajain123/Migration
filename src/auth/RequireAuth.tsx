import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

/** Route guard: unauthenticated visitors go to /login and return to the page they asked for afterwards. */
export function RequireAuth() {
  const session = useAuthStore((s) => s.session);
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/** Login/signup are not shown to signed-in users. */
export function RedirectIfAuthed() {
  const session = useAuthStore((s) => s.session);
  if (session) return <Navigate to="/" replace />;
  return <Outlet />;
}
