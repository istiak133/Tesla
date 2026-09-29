import {
  BD_PHONE,
  LICENCE_NUMBER,
  NID_NUMBER,
  PASSPORT_NUMBER,
  PLATE_NUMBER,
  normalizeDocumentNumber,
  normalizePhone,
  normalizePlate,
  normalizeText,
} from './identity.js';

describe('sign-up values in one stored form (D-015)', () => {
  it('turns every usual way of writing a mobile number into +8801XXXXXXXXX', () => {
    for (const typed of [
      '01712345678',
      '01712-345678',
      '+880 1712 345678',
      '8801712345678',
      '+8801712345678',
    ]) {
      expect(normalizePhone(typed)).toBe('+8801712345678');
    }
  });

  it('accepts only Bangladeshi mobile numbers', () => {
    expect(BD_PHONE.test(normalizePhone('01712345678') as string)).toBe(true);
    expect(BD_PHONE.test(normalizePhone('01212345678') as string)).toBe(false); // no operator 2
    expect(BD_PHONE.test(normalizePhone('0171234567') as string)).toBe(false); // one digit short
    expect(BD_PHONE.test(normalizePhone('+441712345678') as string)).toBe(
      false,
    );
  });

  it('knows the NID and passport formats', () => {
    expect(NID_NUMBER.test('1234567890')).toBe(true); // smart card
    expect(NID_NUMBER.test('1234567890123')).toBe(true);
    expect(NID_NUMBER.test('19901234567890123')).toBe(true);
    expect(NID_NUMBER.test('12345678901')).toBe(false); // 11 digits
    expect(
      PASSPORT_NUMBER.test(normalizeDocumentNumber('a0123 4567') as string),
    ).toBe(true);
    expect(PASSPORT_NUMBER.test('AB1234567')).toBe(true);
    expect(PASSPORT_NUMBER.test('1234567890')).toBe(false);
  });

  it('stores licences and plates in capitals', () => {
    expect(normalizeDocumentNumber('dk-0123456 c00001')).toBe(
      'DK0123456C00001',
    );
    expect(LICENCE_NUMBER.test('DK0123456C00001')).toBe(true);
    expect(normalizePlate('  dhaka  metro-ga 12-3456 ')).toBe(
      'DHAKA METRO-GA 12-3456',
    );
    expect(PLATE_NUMBER.test('DHAKA METRO-GA 12-3456')).toBe(true);
    expect(PLATE_NUMBER.test('-')).toBe(false);
  });

  it('tidies names and addresses, and leaves non-strings for validation', () => {
    expect(normalizeText('  House 12,   Road 11  ')).toBe('House 12, Road 11');
    expect(normalizePhone(42)).toBe(42);
  });
});
