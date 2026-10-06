import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CancelRideDto {
  // The fee the passenger saw on the cancel button. If the fee at this moment is higher (the
  // car reached their stop in between), the cancel is refused instead of charging a surprise.
  // Left out (old clients, the API used directly): no check.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  expectedFeePaisa?: number;
}
