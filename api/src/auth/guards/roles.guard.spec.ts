import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../generated/prisma/client.js';
import { RolesGuard } from './roles.guard.js';

// A minimal fake of what NestJS passes to a guard.
function contextFor(user: { role: Role } | undefined): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardAllowing(roles: Role[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: () => roles } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows any logged-in user when the route has no @Roles', () => {
    const guard = guardAllowing(undefined);

    expect(guard.canActivate(contextFor({ role: Role.PASSENGER }))).toBe(true);
  });

  it('allows a driver on a driver-only route', () => {
    const guard = guardAllowing([Role.DRIVER]);

    expect(guard.canActivate(contextFor({ role: Role.DRIVER }))).toBe(true);
  });

  it('forbids a passenger on a driver-only route', () => {
    const guard = guardAllowing([Role.DRIVER]);

    expect(() =>
      guard.canActivate(contextFor({ role: Role.PASSENGER })),
    ).toThrow(ForbiddenException);
  });
});
