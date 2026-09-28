import { LogLevel, NodeEnv, validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    const env = validateEnv({});

    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe(LogLevel.Info);
  });

  it('converts numeric strings from the environment', () => {
    expect(validateEnv({ PORT: '4000' }).PORT).toBe(4000);
  });

  it('refuses to start with an invalid port', () => {
    expect(() => validateEnv({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('refuses to start with an unknown NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
