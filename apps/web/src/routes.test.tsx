import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from './routes';
import { signedIn, signedOut, stubApi, testRunner } from './test/api';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('routes', () => {
  it.each([
    ['/fitness-profile', 'Fitness Profile'],
    ['/search-area', 'Search Area'],
    ['/results', 'Results'],
    ['/no-such-page', 'Page not found'],
  ])('renders %s inside the layout when signed in', async (path, heading) => {
    stubApi(signedIn());
    renderAt(path);

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('sends an onboarded Runner from / to Results', async () => {
    stubApi(signedIn());
    const router = renderAt('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Results' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/results');
  });

  it('sends a Runner who isn’t onboarded from / (and from /login) to the wizard', async () => {
    stubApi(signedIn({ ...testRunner, onboarded: false }));
    const router = renderAt('/login');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Here’s how fast we think you are' }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/welcome');
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('shows the home page at / when signed out', async () => {
    stubApi(signedOut());
    renderAt('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'myKOM' })).toBeVisible();
  });

  it('renders /login when signed out', async () => {
    stubApi(signedOut());
    renderAt('/login');

    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
  });

  it('navigates via the nav and marks the current page', async () => {
    stubApi(signedIn());
    const router = renderAt('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });

    await userEvent.click(within(nav).getByRole('link', { name: 'Search Area' }));

    expect(router.state.location.pathname).toBe('/search-area');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search Area' })).toBeVisible();
    expect(within(nav).getByRole('link', { name: 'Search Area' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
