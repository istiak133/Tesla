import { LogLevel, NodeEnv, validateEnv } from './env.validation.js';

const DATABASE_URL = 'postgresql://tesla:tesla@localhost:5432/tesla';

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    const env = validateEnv({ DATABASE_URL });

    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe(LogLevel.Info);
    expect(env.DATABASE_POOL_MAX).toBe(5);
  });

  it('converts numeric strings from the environment', () => {
    expect(validateEnv({ DATABASE_URL, PORT: '4000' }).PORT).toBe(4000);
  });

  it('refuses to start with an invalid port', () => {
    expect(() => validateEnv({ DATABASE_URL, PORT: '70000' })).toThrow(/PORT/);
  });

  it('refuses to start with an unknown NODE_ENV', () => {
    expect(() => validateEnv({ DATABASE_URL, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('refuses to start without a database URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuses a database URL that is not PostgreSQL', () => {
    expect(() => validateEnv({ DATABASE_URL: 'mysql://x' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
