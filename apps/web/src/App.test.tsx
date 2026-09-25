import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

function mockFetchResponse(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('home page', () => {
  it('shows the health status from the API', async () => {
    const fetchMock = mockFetchResponse(200, { ok: true, db: 'up' });
    render(<App />);

    expect(screen.getByText('Checking…')).toBeInTheDocument();
    expect(await screen.findByText('OK')).toBeInTheDocument();
    expect(screen.getByText('Up')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('shows the database as down when health reports 503', async () => {
    mockFetchResponse(503, { ok: false, db: 'down' });
    render(<App />);

    expect(await screen.findByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('Down')).toBeInTheDocument();
  });

  it('shows the API as unreachable when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<App />);

    expect(await screen.findByText('API: unreachable')).toBeInTheDocument();
  });

  it('shows the API as unreachable when the response is not a health status', async () => {
    mockFetchResponse(502, { error: 'Bad Gateway' });
    render(<App />);

    expect(await screen.findByText('API: unreachable')).toBeInTheDocument();
  });
});
