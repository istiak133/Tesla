// The shapes returned by the API (kept in step with api/src/rides/ride.views.ts
// and api/src/driver/driver.service.ts).

export type Role = "PASSENGER" | "DRIVER";

export type RideStatus =
  | "REQUESTED"
  | "MATCHED"
  | "DRIVER_ARRIVED"
  | "STARTED"
  | "COMPLETED"
  | "CANCELLED";

export type User = { id: string; name: string; email: string; role: Role };

export type Zone = { id: string; code: string; name: string };

export type Ride = {
  id: string;
  status: RideStatus;
  pickup: { code: string; name: string };
  dropoff: { code: string; name: string };
  seats: number;
  distanceKm: number;
  estimatedFarePaisa: number;
  finalFarePaisa: number | null;
  createdAt: string;
  driver: { name: string; vehicleName: string } | null;
  coRiders: string[];
  history: { status: RideStatus; reason: string; at: string }[];
};

export type RideSummary = {
  id: string;
  status: RideStatus;
  pickup: string;
  dropoff: string;
  seats: number;
  farePaisa: number;
  createdAt: string;
};

export type WaitingRequest = {
  id: string;
  passengerName: string;
  pickup: string;
  dropoff: string;
  seats: number;
  distanceKm: number;
  estimatedFarePaisa: number;
  requestedAt: string;
  canAccept: boolean;
  reason: string | null;
};

export type DriverState = {
  vehicle: { name: string; seatCapacity: number; isOnline: boolean };
  pool: {
    id: string;
    status: RideStatus;
    pickup: string;
    seatCapacity: number;
    seatsTaken: number;
    passengers: {
      rideId: string;
      name: string;
      seats: number;
      dropoff: string;
      estimatedFarePaisa: number;
      finalFarePaisa: number | null;
    }[];
  } | null;
};
