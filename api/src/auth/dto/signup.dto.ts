import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;
}
