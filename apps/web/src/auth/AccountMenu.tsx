import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, type Me } from './AuthContext';

const buttonClass =
  'rounded px-3 py-2 text-sm font-medium whitespace-nowrap text-gray-700 hover:bg-gray-100 hover:text-gray-900';

function Avatar({ me }: { me: Me }) {
  if (me.avatarUrl) {
    return <img src={me.avatarUrl} alt="" className="size-8 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-8 items-center justify-center rounded-full bg-orange-100 text-sm font-semibold text-orange-800"
    >
      {me.firstName.charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function DisconnectDialog({
  onCancel,
  onConfirm,
}: {
  onCancel(): void;
  onConfirm(): Promise<void>;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  async function confirm() {
    setPending(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="disconnect-title"
        aria-describedby="disconnect-description"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 id="disconnect-title" className="text-lg font-semibold">
          Disconnect Strava?
        </h2>
        <p id="disconnect-description" className="mt-2 text-gray-700">
          This revokes myKOM’s access to your Strava account and permanently deletes all your myKOM
          data, including your Fitness Profile and Search Area. You can connect again later, but
          you’ll start from scratch.
        </p>
        {failed && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            Couldn’t disconnect. Please try again.
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
          >
            {pending ? 'Deleting…' : 'Disconnect and delete my data'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The signed-in Runner's avatar and name, with Log out and Disconnect. */
export function AccountMenu({ me }: { me: Me }) {
  const { logOut, disconnect } = useAuth();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [logOutFailed, setLogOutFailed] = useState(false);
  const closeDialog = useCallback(() => setConfirming(false), []);

  async function handleLogOut() {
    setLogOutFailed(false);
    try {
      await logOut();
      navigate('/login', { replace: true });
    } catch {
      setLogOutFailed(true);
    }
  }

  async function handleDisconnect() {
    await disconnect();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="mr-2 flex items-center gap-2">
        <Avatar me={me} />
        <span className="text-sm font-medium">{me.firstName}</span>
      </div>
      <button type="button" onClick={handleLogOut} className={buttonClass}>
        Log out
      </button>
      <button type="button" onClick={() => setConfirming(true)} className={buttonClass}>
        Disconnect
      </button>
      {logOutFailed && (
        <p role="alert" className="w-full text-sm text-red-700">
          Couldn’t log out. Please try again.
        </p>
      )}
      {confirming && <DisconnectDialog onCancel={closeDialog} onConfirm={handleDisconnect} />}
    </div>
  );
}
