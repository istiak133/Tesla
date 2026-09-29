import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { IdDocumentType } from '../../generated/prisma/client.js';
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
} from '../identity.js';

// What both kinds of user give at sign-up (D-015). Values are tidied first (@Transform),
// then checked. Unknown fields are refused by the global ValidationPipe, so nobody can
// send a role: the endpoint decides it.
export class SignupDto {
  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  @MaxLength(200)
  email: string;

  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(BD_PHONE, {
    message: 'Mobile number must be a Bangladeshi number, e.g. 01712345678',
  })
  phone: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  presentAddress: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @MinLength(5)
  @MaxLength(200)
  permanentAddress: string;
}

export class PassengerSignupDto extends SignupDto {}

// The number must fit the document chosen: an NID is digits only, a passport starts with letters.
@ValidatorConstraint({ name: 'idNumberFitsType' })
class IdNumberFitsType implements ValidatorConstraintInterface {
  validate(idNumber: unknown, args: ValidationArguments): boolean {
    const { idType } = args.object as DriverSignupDto;
    if (typeof idNumber !== 'string') {
      return false;
    }
    if (idType === IdDocumentType.NID) {
      return NID_NUMBER.test(idNumber);
    }
    if (idType === IdDocumentType.PASSPORT) {
      return PASSPORT_NUMBER.test(idNumber);
    }
    return false;
  }

  defaultMessage(args: ValidationArguments): string {
    const { idType } = args.object as DriverSignupDto;
    return idType === IdDocumentType.PASSPORT
      ? 'Passport number must look like A01234567'
      : 'NID number must be 10, 13 or 17 digits';
  }
}

export class DriverSignupDto extends SignupDto {
  // One identity document is enough: the driver picks NID or passport.
  @IsEnum(IdDocumentType)
  idType: IdDocumentType;

  @Transform(({ value }) => normalizeDocumentNumber(value))
  @Validate(IdNumberFitsType)
  idNumber: string;

  @Transform(({ value }) => normalizeDocumentNumber(value))
  @IsString()
  @Matches(LICENCE_NUMBER, {
    message: 'Driving licence number must be 8 to 20 letters and digits',
  })
  licenceNumber: string;

  @Transform(({ value }) => normalizeText(value))
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  vehicleName: string;

  @Transform(({ value }) => normalizePlate(value))
  @IsString()
  @Matches(PLATE_NUMBER, {
    message: 'Number plate must look like DHAKA METRO-GA 12-3456',
  })
  plateNumber: string;
}
