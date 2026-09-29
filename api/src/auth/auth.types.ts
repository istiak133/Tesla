import { Role, User } from '../generated/prisma/client.js';

/** What the API returns about a user. Never includes the password hash. */
export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
