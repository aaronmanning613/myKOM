import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from './routes';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('routes', () => {
  beforeEach(() => {
    // The home page checks the API's health.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, db: 'up' }))),
    );
  });

  it.each([
    ['/', 'myKOM'],
    ['/login', 'Log in'],
    ['/fitness-profile', 'Fitness Profile'],
    ['/search-area', 'Search Area'],
    ['/results', 'Results'],
    ['/no-such-page', 'Page not found'],
  ])('renders %s inside the layout', async (path, heading) => {
    renderAt(path);

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('shows Results as coming soon', async () => {
    renderAt('/results');

    expect(await screen.findByText(/coming soon/i)).toBeInTheDocument();
  });

  it('navigates via the nav and marks the current page', async () => {
    const router = renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Main' });

    await userEvent.click(within(nav).getByRole('link', { name: 'Search Area' }));

    expect(router.state.location.pathname).toBe('/search-area');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search Area' })).toBeVisible();
    expect(within(nav).getByRole('link', { name: 'Search Area' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
