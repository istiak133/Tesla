// What people type at sign-up, turned into one stored form (D-015), so that
// "01712-345678" and "+880 1712 345678" are the same phone, and "a1234567" the same passport as "A1234567".
// Used by the sign-up DTOs before validation; the database checks the same formats again.

/** A Bangladeshi mobile number: +880, then 1, an operator digit 3–9 and eight more digits. */
export const BD_PHONE = /^\+8801[3-9]\d{8}$/;
/** National ID: 10 digits (smart card), or the older 13 or 17 digits. */
export const NID_NUMBER = /^(\d{10}|\d{13}|\d{17})$/;
/** Passport: one or two capital letters, then 7 or 8 digits (e.g. A01234567). */
export const PASSPORT_NUMBER = /^[A-Z]{1,2}\d{7,8}$/;
/** Driving licence: 8 to 20 capital letters and digits (e.g. DK0123456C00001). */
export const LICENCE_NUMBER = /^[A-Z0-9]{8,20}$/;
/** Number plate: capital letters, digits, spaces and dashes (e.g. DHAKA METRO-GA 12-3456). */
export const PLATE_NUMBER = /^[A-Z0-9][A-Z0-9 -]{2,28}[A-Z0-9]$/;

/** Local or international forms become +8801XXXXXXXXX; anything else is left for validation to refuse. */
export function normalizePhone(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const digits = value.replace(/[\s-]/g, '');
  if (/^01\d{9}$/.test(digits)) {
    return `+88${digits}`;
  }
  if (/^8801\d{9}$/.test(digits)) {
    return `+${digits}`;
  }
  return digits;
}

/** ID, passport and licence numbers: no spaces or dashes, capital letters. */
export function normalizeDocumentNumber(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return value.replace(/[\s-]/g, '').toUpperCase();
}

/** Plates keep their dashes and single spaces, in capitals. */
export function normalizePlate(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Names and addresses: no spaces at the ends, and no runs of spaces inside. */
export function normalizeText(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim().replace(/\s+/g, ' ');
}
