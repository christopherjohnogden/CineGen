import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/cloud/cloud-account', () => ({
  CloudAccountCard: () => <section aria-label="Cloud account" />,
}));

import { SettingsPage } from '@/components/settings/settings-page';

const setupLtx25 = vi.fn();
const statusLtx25 = vi.fn();

function installElectronApi() {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      pod: {
        setupLtx25,
        statusLtx25,
        terminateLtx25: vi.fn(),
      },
      higgsfield: {
        accountStatus: vi.fn().mockResolvedValue({ connected: false }),
        authLogin: vi.fn(),
        authLogout: vi.fn(),
      },
      artlist: {
        accountStatus: vi.fn().mockResolvedValue({ connected: false, configured: false }),
        authLogin: vi.fn(),
        authLogout: vi.fn(),
      },
    },
  });
}

describe('Settings RunPod generation session', () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    setupLtx25.mockReset().mockResolvedValue({
      podId: 'pod-new',
      podUrl: 'https://pod-new-8000.proxy.runpod.net',
      podAuthToken: 'session-token',
      secretIds: ['secret-1', 'secret-2'],
      status: 'downloading',
      phase: 'downloading',
      gpuProfile: 'performance',
    });
    statusLtx25.mockReset().mockResolvedValue({ status: 'ready', phase: 'ready', ready: true });
    installElectronApi();
  });

  it('defaults to both image models and sends the persisted next-session choices', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodKey: 'rp_test_key',
      huggingFaceToken: 'hf_testToken123',
      runpodLtxGpuProfile: 'impossibly-fast',
    }));

    render(<SettingsPage onBack={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /Balanced/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Saved for the next Pod/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Stable Diffusion XL/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: /Qwen Image Edit/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('~103.9 GB')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Maximum speed/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Qwen Image Edit/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand RunPod charges/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Start generation session' }));

    await waitFor(() => expect(setupLtx25).toHaveBeenCalledWith({
      runpodKey: 'rp_test_key',
      huggingFaceToken: 'hf_testToken123',
      gpuProfile: 'performance',
      imageModels: ['sdxl'],
    }));
    expect(JSON.parse(localStorage.getItem('cinegen_settings') ?? '{}')).toMatchObject({
      runpodLtxGpuProfile: 'performance',
      runpodLtxImageModels: ['sdxl'],
    });
  });

  it('normalizes invalid and duplicate saved image-model values', async () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodLtxImageModels: ['qwen-image-edit', 'unknown-model', 'qwen-image-edit'],
    }));

    render(<SettingsPage onBack={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: /Stable Diffusion XL/i })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('checkbox', { name: /Qwen Image Edit/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('~97.0 GB')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('cinegen_settings') ?? '{}')).toMatchObject({
      runpodLtxImageModels: ['qwen-image-edit'],
    }));
  });

  it('locks the choice while a Pod exists without changing or restarting it', () => {
    localStorage.setItem('cinegen_settings', JSON.stringify({
      runpodKey: 'rp_test_key',
      huggingFaceToken: 'hf_testToken123',
      runpodLtxPodId: 'pod-active',
      runpodLtxPodUrl: 'https://pod-active-8000.proxy.runpod.net',
      runpodLtxPodAuthToken: 'session-token',
      runpodLtxStatus: 'ready',
      runpodLtxGpuProfile: 'economy',
    }));

    render(<SettingsPage onBack={vi.fn()} />);

    const economy = screen.getByRole('radio', { name: /Lower cost/i });
    const performance = screen.getByRole('radio', { name: /Maximum speed/i });
    const sdxl = screen.getByRole('checkbox', { name: /Stable Diffusion XL/i });
    const qwen = screen.getByRole('checkbox', { name: /Qwen Image Edit/i });
    expect(economy).toHaveAttribute('aria-checked', 'true');
    expect(economy).toBeDisabled();
    expect(performance).toBeDisabled();
    expect(sdxl).toBeDisabled();
    expect(sdxl).toHaveAttribute('aria-checked', 'false');
    expect(qwen).toBeDisabled();
    expect(qwen).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('LTX-2.5 video only')).toBeInTheDocument();
    expect(screen.getByText(/will not change or restart the active Pod/i)).toBeInTheDocument();

    fireEvent.click(performance);
    fireEvent.click(sdxl);

    expect(performance).toHaveAttribute('aria-checked', 'false');
    expect(sdxl).toHaveAttribute('aria-checked', 'false');
    expect(setupLtx25).not.toHaveBeenCalled();
    expect(statusLtx25).not.toHaveBeenCalled();
  });
});
