import { clientIp } from './client-ip.js';

describe('clientIp (the rate-limit key)', () => {
  it('uses the first X-Forwarded-For entry: the original client', () => {
    expect(
      clientIp({
        headers: { 'x-forwarded-for': '203.0.113.7, 76.76.21.9, 172.64.1.2' },
        ip: '10.0.0.5',
      }),
    ).toBe('203.0.113.7');
  });

  it('stays the same when the proxies in between change', () => {
    const first = clientIp({
      headers: { 'x-forwarded-for': '203.0.113.7, 76.76.21.9' },
      ip: '10.0.0.5',
    });
    const second = clientIp({
      headers: { 'x-forwarded-for': '203.0.113.7, 76.76.21.142, 172.64.9.9' },
      ip: '10.0.0.8',
    });
    expect(first).toBe(second);
  });

  it('falls back to the connection address without the header', () => {
    expect(clientIp({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
  });
});
