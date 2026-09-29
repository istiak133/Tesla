import { IsUUID } from 'class-validator';

export class SetLocationDto {
  @IsUUID()
  zoneId: string;
}
