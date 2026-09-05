import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeMcpConnect } from '@/components/settings/claude-mcp-connect';
const initial = { configured: false, needsRepair: false, supported: true, serverAvailable: true, configPath: '/test/config.json' };
function mockApi() {
  const api = { status: vi.fn(async () => initial), setup: vi.fn(async () => ({ ...initial, configured: true })), remove: vi.fn(async () => initial), reveal: vi.fn(async () => {}) };
  (window as unknown as { electronAPI: unknown }).electronAPI = { claudeMcp: api };
  return api;
}
afterEach(() => { cleanup(); delete (window as unknown as { electronAPI?: unknown }).electronAPI; });
describe('Claude Desktop setup card', () => {
  it('sets up only after a click and explains restarting Claude and Developer settings', async () => {
    const api = mockApi(); render(<ClaudeMcpConnect />);
    await screen.findByText('Not set up yet.'); expect(api.setup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Claude Desktop' }));
    await screen.findByText(/Setup saved/);
    expect(api.setup).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Settings → Developer/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await screen.findByText(/CineGen removed/); expect(api.remove).toHaveBeenCalledTimes(1);
  });
  it('shows errors without claiming setup succeeded', async () => {
    const api = mockApi(); api.setup.mockRejectedValue(new Error('Invalid configuration'));
    render(<ClaudeMcpConnect />); await screen.findByText('Not set up yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Claude Desktop' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid configuration');
    expect(screen.queryByText(/Setup saved/)).toBeNull();
  });
  it('offers repair when the app moved or the installed server is outdated', async () => {
    const api = mockApi(); api.status.mockResolvedValue({ ...initial, configured: true, needsRepair: true });
    render(<ClaudeMcpConnect />);
    await screen.findByText('Setup needs updating.');
    expect(screen.getByRole('button', { name: 'Repair Claude setup' })).toBeEnabled();
  });
  it('explains desktop-only setup when the API is unavailable', () => {
    render(<ClaudeMcpConnect />);
    expect(screen.getByText(/Open the latest CineGen desktop app/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Claude Desktop' })).toBeNull();
  });
});
