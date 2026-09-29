import { generateSessionToken, hashSessionToken } from './session-token.js';

describe('session tokens', () => {
  it('generates a different token every time', () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });

  it('hashes the same token to the same value, and never returns the token itself', () => {
    const token = generateSessionToken();

    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
  });
});
