export interface RatingData {
  login: string;
  score: number;
  isLowRating: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AliasEntry {
  login: string;
  alias: string;
}

export type AliasMap = Record<string, string>;
