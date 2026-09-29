import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class RequestRideDto {
  @IsUUID()
  pickupZoneId: string;

  @IsUUID()
  dropoffZoneId: string;

  @IsInt()
  @Min(1)
  @Max(3)
  seats: number;
}
