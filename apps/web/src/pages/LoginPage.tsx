import { Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ConnectWithStravaButton } from '../auth/ConnectWithStravaButton';

// Keyed by the API's `LoginError`: why the Strava callback sent the Runner back here.
const errorMessages: Record<string, string> = {
  access_denied: 'You didn’t authorize myKOM on Strava. Connect again to get started.',
  invalid_state: 'Your sign-in expired or couldn’t be verified. Please try again.',
  strava: 'Strava couldn’t complete the sign-in. Please try again.',
};

export function LoginPage() {
  const auth = useAuth();
  const [searchParams] = useSearchParams();

  if (auth.status === 'signed-in') return <Navigate to="/" replace />;

  const disconnected = auth.status === 'signed-out' && auth.disconnected;
  const error = searchParams.get('error');
  const errorMessage = error ? (errorMessages[error] ?? errorMessages.strava) : undefined;

  return (
    <>
      <h1 className="text-2xl font-bold">Log in</h1>
      {disconnected && (
        <p role="status" className="mt-4 rounded bg-green-50 p-3 text-green-800">
          Strava is disconnected and your myKOM data has been deleted.
        </p>
      )}
      {errorMessage && (
        <p role="alert" className="mt-4 rounded bg-red-50 p-3 text-red-800">
          {errorMessage}
        </p>
      )}
      <p className="mt-2 text-gray-700">
        myKOM works from your Strava account. Connect it to get started.
      </p>
      <div className="mt-6">
        <ConnectWithStravaButton />
      </div>
    </>
  );
}
