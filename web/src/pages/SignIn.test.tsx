import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignIn } from './SignIn';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function renderSignIn() {
  const router = createMemoryRouter(
    [
      { path: '/signin', element: <SignIn /> },
      { path: '/welcome', element: <p>welcome page</p> },
      { path: '/r/:id', element: <p>room page</p> },
    ],
    { initialEntries: ['/signin?next=%2Fr%2Fabcdefghij'] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SignIn', () => {
  it('sends a code, verifies it with the challenge, and continues to the next page', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(200, { challenge: 'c'.repeat(43) }))
      .mockResolvedValueOnce(json(200, { user: { id: '1', email: 'ada@example.com', onboarded: true } }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    const router = renderSignIn();

    await user.type(screen.getByLabelText('Email'), 'Ada@Example.com');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Code'), '1234 5678');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('room page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/r/abcdefghij');

    const verifyBody = JSON.parse(fetch.mock.calls[1]![1].body as string);
    expect(verifyBody).toEqual({ email: 'ada@example.com', code: '1234 5678', challenge: 'c'.repeat(43) });
  });

  it('shows field errors from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(400, {
          error: {
            code: 'validation_failed',
            message: 'Invalid.',
            fields: { email: 'Enter a valid email address.' },
          },
        }),
      ),
    );
    const user = userEvent.setup();
    renderSignIn();
    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });
});
