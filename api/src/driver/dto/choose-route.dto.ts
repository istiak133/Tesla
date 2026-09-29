import { IsUUID } from 'class-validator';

export class ChooseRouteDto {
  @IsUUID()
  routeId: string;
}
