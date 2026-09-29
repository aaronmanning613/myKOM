import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../routes';
import { json, signedIn, signedOut, stubApi, testRunner } from '../test/api';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const header = () => screen.getByRole('banner');

describe('signed out', () => {
  it.each(['/fitness-profile', '/search-area', '/results'])(
    'sends %s to the login page',
    async (path) => {
      stubApi(signedOut());
      const router = renderAt(path);

      expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
      expect(router.state.location.pathname).toBe('/login');
    },
  );

  it('shows a Log in link and no Runner nav in the header', async () => {
    stubApi(signedOut());
    renderAt('/');

    expect(await within(header()).findByRole('link', { name: 'Log in' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(within(header()).queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('offers Connect with Strava, pointing at the API', async () => {
    stubApi(signedOut());
    renderAt('/login');

    const connect = await screen.findByRole('link', { name: 'Connect with Strava' });
    expect(connect).toHaveAttribute('href', '/api/auth/strava');
  });

  it('treats an unreachable API as signed out', async () => {
    stubApi({ 'GET /api/me': () => Promise.reject(new TypeError('Failed to fetch')) });
    renderAt('/fitness-profile');

    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
  });

  it.each([
    ['access_denied', /didn’t authorize myKOM/],
    ['invalid_state', /expired or couldn’t be verified/],
    ['strava', /Strava couldn’t complete the sign-in/],
    ['something_else', /Strava couldn’t complete the sign-in/],
  ])('explains a %s sign-in error', async (error, message) => {
    stubApi(signedOut());
    renderAt(`/login?error=${error}`);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });
});

describe('signed in', () => {
  it('shows the Runner’s avatar and name in the header', async () => {
    stubApi(signedIn());
    renderAt('/fitness-profile');

    expect(await within(header()).findByText('Paula')).toBeVisible();
    expect(header().querySelector('img')).toHaveAttribute('src', testRunner.avatarUrl);
    expect(within(header()).getByRole('button', { name: 'Log out' })).toBeVisible();
    expect(within(header()).getByRole('button', { name: 'Disconnect' })).toBeVisible();
    expect(within(header()).queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('shows an initial when the Runner has no avatar', async () => {
    stubApi(signedIn({ ...testRunner, avatarUrl: null }));
    renderAt('/');

    expect(await within(header()).findByText('P')).toBeInTheDocument();
    expect(header().querySelector('img')).toBeNull();
  });

  it('sends the login page on to Results for an onboarded Runner', async () => {
    stubApi(signedIn());
    const router = renderAt('/login');

    expect(await screen.findByRole('heading', { level: 1, name: 'Results' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/results');
  });

  it('logs out and returns to the login page', async () => {
    const fetchMock = stubApi({
      ...signedIn(),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });
    const router = renderAt('/fitness-profile');

    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/login');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(within(header()).getByRole('link', { name: 'Log in' })).toBeVisible();
  });

  it('stays signed in when logging out fails', async () => {
    stubApi({ ...signedIn(), 'POST /api/auth/logout': () => json({}, 500) });
    renderAt('/fitness-profile');

    await userEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t log out');
    expect(screen.getByRole('heading', { level: 1, name: 'Fitness Profile' })).toBeVisible();
  });
});

describe('disconnect', () => {
  function stubDisconnect(response: () => Response) {
    return stubApi({ ...signedIn(), 'POST /api/auth/disconnect': response });
  }

  it('asks for confirmation, warning that data will be deleted', async () => {
    const fetchMock = stubDisconnect(() => new Response(null, { status: 204 }));
    renderAt('/fitness-profile');

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Disconnect Strava?' });
    expect(dialog).toHaveAccessibleDescription(/permanently deletes all your myKOM data/);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/disconnect', expect.anything());
  });

  it('does nothing when cancelled', async () => {
    const fetchMock = stubDisconnect(() => new Response(null, { status: 204 }));
    renderAt('/fitness-profile');

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(within(header()).getByText('Paula')).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/disconnect', expect.anything());
  });

  it('closes on Escape', async () => {
    stubDisconnect(() => new Response(null, { status: 204 }));
    renderAt('/fitness-profile');

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('disconnects once confirmed and confirms the data is gone', async () => {
    const fetchMock = stubDisconnect(() => new Response(null, { status: 204 }));
    const router = renderAt('/fitness-profile');

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect and delete my data' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Strava is disconnected and your myKOM data has been deleted.',
    );
    expect(router.state.location.pathname).toBe('/login');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/disconnect', { method: 'POST' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(within(header()).getByRole('link', { name: 'Log in' })).toBeVisible();
  });

  it('keeps the Runner signed in when disconnecting fails', async () => {
    stubDisconnect(() => json({}, 500));
    renderAt('/fitness-profile');

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect and delete my data' }));

    const dialog = screen.getByRole('alertdialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Couldn’t disconnect');
    expect(within(header()).getByText('Paula')).toBeVisible();
  });
});
