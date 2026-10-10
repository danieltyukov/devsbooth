export type ShareOutcome = 'shared' | 'copied' | 'cancelled';

type ShareNavigator = Pick<Navigator, 'clipboard'> & Partial<Pick<Navigator, 'share'>>;

/** Whether this browser has a native share sheet (most phones do, desktop Linux does not). */
export function canShare(nav: ShareNavigator = navigator): boolean {
  return typeof nav.share === 'function';
}

/**
 * Opens the native share sheet when there is one, and copies the link otherwise.
 * Throws only if copying fails too, so the caller can show the link instead.
 */
export async function shareLink(
  url: string,
  title: string,
  nav: ShareNavigator = navigator,
): Promise<ShareOutcome> {
  if (canShare(nav)) {
    try {
      await nav.share!({ title, url });
      return 'shared';
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return 'cancelled';
      // Some browsers refuse to share from certain contexts; copying still works.
    }
  }
  await nav.clipboard.writeText(url);
  return 'copied';
}
