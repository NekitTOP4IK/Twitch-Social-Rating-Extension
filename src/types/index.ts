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
