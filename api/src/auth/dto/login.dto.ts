import {
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../generated/prisma/client.js';

export class LoginDto {
  // The account type chosen on the login page (D-015); it must match the account.
  @IsEnum(Role)
  role: Role;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password: string;
}
