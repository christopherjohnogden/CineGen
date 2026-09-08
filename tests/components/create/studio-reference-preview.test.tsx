import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioReferencePreview, previewAttachedReference, previewElementReference, type ReferencePreview } from '@/components/create/studio-reference-preview';
import type { Element as CineElement } from '@/types/elements';

const submit = vi.fn();
const reference: ReferencePreview = {
  name: 'Cody', category: 'Character element', description: 'A calm, reassuring presence.', look: 'Hero',
  media: [1, 2].map(index => ({ kind: 'image', name: `Cody ${index}`, url: `https://example.com/cody-${index}.jpg` })),
};
function Harness({ data = reference }: { data?: ReferencePreview }) {
  const [open, setOpen] = useState(false);
  return <form onSubmit={submit}><button type="button" onClick={() => setOpen(true)}>Preview reference</button>
    {open && <StudioReferencePreview reference={data} onClose={() => setOpen(false)} />}</form>;
}
function open() {
  const trigger = screen.getByRole('button', { name: 'Preview reference' });
  trigger.focus(); fireEvent.click(trigger); return trigger;
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); this.querySelector<HTMLButtonElement>('button')?.focus(); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Studio reference quick look', () => {
  it('opens an image, reads its dimensions, browses images and restores focus on Escape', () => {
    render(<Harness />); const trigger = open();
    const modal = screen.getByRole('dialog', { name: 'Cody' });
    expect(within(modal).getByText('Character element · Hero')).toBeInTheDocument();
    const image = screen.getByRole('img', { name: 'Cody 1' });
    Object.defineProperties(image, { naturalWidth: { value: 2048 }, naturalHeight: { value: 1152 } });
    fireEvent.load(image);
    expect(screen.getByText('2048 × 1152')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous reference image' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Next reference image' }));
    expect(screen.getByRole('img', { name: 'Cody 2' })).toHaveAttribute('src', 'https://example.com/cody-2.jpg');
    expect(screen.queryByText('2048 × 1152')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next reference image' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(modal, { key: 'ArrowLeft' });
    expect(screen.getByRole('img', { name: 'Cody 1' })).toBeInTheDocument();
    fireEvent(modal, new Event('cancel', { cancelable: true, bubbles: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps the preview open for inside clicks and closes on the backdrop', () => {
    render(<Harness />); open();
    const modal = screen.getByRole('dialog');
    vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 900, top: 100, bottom: 800 } as DOMRect);
    fireEvent.click(modal, { clientX: 200, clientY: 200 });
    expect(modal).toBeInTheDocument();
    fireEvent.click(modal, { clientX: 50, clientY: 50 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('plays video inline, reports duration and dimensions, and stops on close', () => {
    render(<Harness data={{ name: 'Scene.mp4', media: [{ name: 'Scene.mp4', url: '/Users/chris/Scene.mp4', kind: 'video', fileSize: 2097152 }] }} />);
    open();
    const video = screen.getByRole('dialog').querySelector('video')!;
    expect(video).toHaveAttribute('src', 'local-media://file/Users/chris/Scene.mp4');
    expect(video).toHaveAttribute('controls');
    expect(video).not.toHaveAttribute('autoplay');
    Object.defineProperties(video, { duration: { value: 32 }, videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
    fireEvent.loadedMetadata(video);
    expect(screen.getByText('0:32')).toBeInTheDocument();
    expect(screen.getByText('1920 × 1080')).toBeInTheDocument();
    expect(screen.getByText('2.0 MB')).toBeInTheDocument();
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    fireEvent.click(screen.getByRole('button', { name: 'Close reference preview' }));
    expect(video.paused).toBe(true);
  });

  it('opens the gold audio player with its metadata without removal controls', () => {
    render(<Harness data={{ name: 'Voice.wav', media: [{ name: 'Voice.wav', url: 'https://example.com/voice.wav', kind: 'audio' }] }} />);
    open();
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('button', { name: 'Play Voice.wav' })).toBeInTheDocument();
    expect(within(modal).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    const audio = modal.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { value: 600 });
    fireEvent.loadedMetadata(audio);
    expect(within(modal).getAllByText('10:00')).toHaveLength(2);
  });

  it('handles a missing preview and an element without images without removing the reference', () => {
    const { unmount } = render(<Harness />); open();
    fireEvent.error(screen.getByRole('img', { name: 'Cody 1' }));
    expect(screen.getByRole('status')).toHaveTextContent('Your reference is still attached');
    fireEvent.click(screen.getByRole('button', { name: 'Next reference image' }));
    expect(screen.getByRole('img', { name: 'Cody 2' })).toBeInTheDocument();
    unmount();
    render(<Harness data={{ name: 'Empty', media: [] }} />); open();
    expect(screen.getByText('This element has no reference images yet.')).toBeInTheDocument();
  });

  it('shows the active element look and only uses file metadata for the actual attached source', () => {
    const image = { id: 'a', url: 'https://example.com/clean.png', createdAt: '', source: 'upload' as const };
    const element = { name: 'Car', type: 'vehicle', description: 'Black coupe', images: [image], activeVariationId: 'damaged', variations: [
      { id: 'clean', name: 'Clean', images: [image] },
      { id: 'damaged', name: 'Damaged', description: 'Scratched door', images: [{ ...image, url: 'https://example.com/damaged.png' }] },
    ] } as CineElement;
    expect(previewElementReference(element)).toMatchObject({ look: 'Damaged', category: 'Vehicle element', description: 'Black coupe\n\nScratched door', media: [{ url: 'https://example.com/damaged.png' }] });
    const file = { name: 'Edited.wav', url: 'https://example.com/trimmed.wav', kind: 'audio' as const };
    expect(previewAttachedReference(file, [{ id: 'x', name: 'Original.wav', type: 'audio', url: 'https://example.com/original.wav', duration: 120, createdAt: '' }]).media[0].duration).toBeUndefined();
  });
});
