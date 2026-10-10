import { describe, expect, it, vi } from 'vitest';
import { canShare, shareLink } from './share';

function nav(share?: (data: ShareData) => Promise<void>) {
  return { share, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } as unknown as Clipboard };
}

describe('shareLink', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const n = nav(share);
    expect(canShare(n)).toBe(true);
    await expect(shareLink('https://x/r/1', 'Topic', n)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Topic', url: 'https://x/r/1' });
    expect(n.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('reports a dismissed share sheet without copying', async () => {
    const n = nav(vi.fn().mockRejectedValue(new DOMException('dismissed', 'AbortError')));
    await expect(shareLink('https://x/r/1', 'Topic', n)).resolves.toBe('cancelled');
    expect(n.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('copies when sharing fails or is not available', async () => {
    const failing = nav(vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')));
    await expect(shareLink('https://x/r/1', 'Topic', failing)).resolves.toBe('copied');
    const desktop = nav();
    expect(canShare(desktop)).toBe(false);
    await expect(shareLink('https://x/r/1', 'Topic', desktop)).resolves.toBe('copied');
    expect(desktop.clipboard.writeText).toHaveBeenCalledWith('https://x/r/1');
  });
});
