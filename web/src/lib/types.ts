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

export type Route = {
  id: string;
  code: string;
  name: string;
  stops: { position: number; zone: Zone }[];
};

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
  route: {
    name: string;
    stops: string[];
    pickupStop: number;
    dropoffStop: number;
    carStop: number;
    carAtStop: boolean;
  } | null;
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
  pickupKmAhead: number | null; // how far the car drives to the pickup; null: not reachable
  canAccept: boolean;
  reason: string | null;
};

export type TripPassenger = {
  rideId: string;
  name: string;
  status: RideStatus;
  seats: number;
  pickup: string;
  dropoff: string;
  pickupStop: number;
  dropoffStop: number;
  estimatedFarePaisa: number;
  finalFarePaisa: number | null;
};

export type DriverState = {
  vehicle: {
    name: string;
    seatCapacity: number;
    isOnline: boolean;
    route: { id: string; name: string } | null;
    currentZone: { id: string; name: string } | null;
  };
  pool: {
    id: string;
    status: RideStatus;
    route: string;
    stops: string[];
    currentStop: number;
    hasPickedUp: boolean;
    seatCapacity: number;
    seatsTaken: number;
    passengers: TripPassenger[];
  } | null;
};

export type PastTrip = {
  id: string;
  status: RideStatus;
  route: string;
  startedAt: string | null;
  endedAt: string | null;
  // The money split, locked when the trip completed (null for a cancelled trip).
  collectedPaisa: number | null;
  driverEarningsPaisa: number | null;
  platformFeePaisa: number | null;
  passengers: {
    name: string;
    pickup: string;
    dropoff: string;
    seats: number;
    finalFarePaisa: number | null;
  }[];
};

export type RouteSuggestions = {
  currentZone: { id: string; name: string } | null;
  suggestedRouteId: string | null;
  routes: {
    routeId: string;
    name: string;
    passesYou: boolean;
    waitingAhead: number;
  }[];
};
