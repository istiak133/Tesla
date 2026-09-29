// Plain errors thrown by AuthService. The controller turns them into HTTP status codes,
// so the service never needs to know about HTTP.

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('Email is already registered');
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    // Same message for "no such email" and "wrong password",
    // so nobody can find out which emails have accounts.
    super('Invalid email or password');
  }
}
