import type { Response } from 'express';

export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000, // 1 dia (alinha ao access JWT)
  });
}
