import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ElevenLabsConnection } from '@/components/elevenlabs/connection';
const api = vi.hoisted(() => ({ status: vi.fn(), authLogin: vi.fn(), authStatus: vi.fn(), authCancel: vi.fn(), voices: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }));
vi.mock('@/lib/elevenlabs/client', () => ({ elevenLabs: api }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('opens the OAuth window from the click before the async login; API key entry stays optional', async () => {
  api.status.mockResolvedValue({ connected: false }); api.authStatus.mockResolvedValue({ connected: false });
  const replace = vi.fn(), popup = { opener: {}, document: { title: '', body: { textContent: '' } }, location: { replace }, close: vi.fn() };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  api.authLogin.mockImplementation(async () => { expect(open).toHaveBeenCalledOnce(); return { attempt: 'attempt', authorizationUrl: 'https://eleven.example/sign-in' }; });
  render(<ElevenLabsConnection />);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect ElevenLabs', exact: true }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('https://eleven.example/sign-in'));
  expect(screen.queryByLabelText('ElevenLabs API key')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open sign-in' })).toBeNull();
  expect(popup.opener).toBeNull();
});
it('offers a sign-in link if popups are blocked and cancels that server-side attempt', async () => {
  api.status.mockResolvedValue({ connected: false }); api.authStatus.mockResolvedValue({ connected: false }); api.authCancel.mockResolvedValue({ cancelled: true });
  vi.spyOn(window, 'open').mockReturnValue(null);
  api.authLogin.mockResolvedValue({ attempt: 'blocked-popup', authorizationUrl: 'https://eleven.example/sign-in' });
  render(<ElevenLabsConnection />);
  fireEvent.click(await screen.findByRole('button', { name: 'Connect ElevenLabs', exact: true }));
  expect((await screen.findByRole('link', { name: 'Open sign-in' })).getAttribute('href')).toBe('https://eleven.example/sign-in');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  await waitFor(() => expect(api.authCancel).toHaveBeenCalledWith('blocked-popup'));
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Open sign-in' })).toBeNull());
});
