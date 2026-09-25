import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from './routes';
import { signedIn, signedOut, stubApi } from './test/api';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('routes', () => {
  it.each([
    ['/', 'myKOM'],
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

  it('renders /login when signed out', async () => {
    stubApi(signedOut());
    renderAt('/login');

    expect(await screen.findByRole('heading', { level: 1, name: 'Log in' })).toBeInTheDocument();
  });

  it('shows Results as coming soon', async () => {
    stubApi(signedIn());
    renderAt('/results');

    expect(await screen.findByText(/coming soon/i)).toBeInTheDocument();
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
