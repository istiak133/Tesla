// Plain errors thrown by AuthService. The controller turns them into HTTP status codes,
// so the service never needs to know about HTTP.

import type { RegisteredField } from '../users/users.repository.js';

const TAKEN_MESSAGE: Record<RegisteredField, string> = {
  email: 'Email is already registered',
  phone: 'Phone number is already registered',
  idNumber: 'This NID or passport is already registered',
  licenceNumber: 'This driving licence is already registered',
  plateNumber: 'This number plate is already registered',
};

export class AlreadyRegisteredError extends Error {
  constructor(readonly field: RegisteredField) {
    super(TAKEN_MESSAGE[field]);
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    // Same message for "no such email" and "wrong password",
    // so nobody can find out which emails have accounts.
    super('Invalid email or password');
  }
}

/**
 * Right email and password, but the other account type was chosen on the login page.
 * Only said after the password matched, so it tells nothing to someone without it.
 */
export class WrongAccountTypeError extends Error {
  constructor(actual: 'PASSENGER' | 'DRIVER') {
    super(
      actual === 'DRIVER'
        ? 'This is a driver account: choose Driver to log in'
        : 'This is a passenger account: choose Passenger to log in',
    );
  }
}
