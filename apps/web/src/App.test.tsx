import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the product shell and reports API reachability', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'AI Execution Assistant' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('API reachable')).toBeInTheDocument();
  });
});
