import { RatingData } from '../types';

const BASE_URL = 'http://localhost:8000';

export async function fetchRating(
  login: string,
  channelLogin: string,
): Promise<RatingData | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/ratings/${encodeURIComponent(channelLogin)}/${encodeURIComponent(login)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      login: data.login,
      score: data.score,
      isLowRating: data.score < 0,
    };
  } catch {
    return null;
  }
}
