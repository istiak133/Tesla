import { SetMetadata } from '@nestjs/common';
import { Role } from '../../generated/prisma/client.js';

export const ROLES_KEY = 'roles';

/** Marks a route as allowed only for these roles, e.g. @Roles(Role.DRIVER). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
