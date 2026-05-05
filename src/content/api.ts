import browser from 'webextension-polyfill';
import { RatingData } from '../types';

// Route through background script to avoid mixed-content / CORS restrictions
// that Firefox applies to content-script fetch() on HTTPS pages.
export async function fetchRating(
  login: string,
  channelLogin: string,
): Promise<RatingData | null> {
  try {
    const result = await browser.runtime.sendMessage({
      type: 'FETCH_RATING',
      login,
      channelLogin,
    });
    return (result as RatingData | null) ?? null;
  } catch {
    return null;
  }
}
