# State Machines

One status set is shared by pools and ride requests (docs/assumptions.md §5). Driver actions change the
pool and every active passenger in it in the same transaction, under the vehicle lock.
Any transition not listed here is rejected with **409 `INVALID_TRANSITION`**. Every change writes a
`ride_events` row (actor, reason, time).

## Ride request

```mermaid
stateDiagram-v2
    [*] --> REQUESTED: passenger requests (solo estimate)
    REQUESTED --> MATCHED: auto-joins an open pool / driver accepts
    MATCHED --> DRIVER_ARRIVED: driver arrives
    DRIVER_ARRIVED --> STARTED: driver starts (fares locked)
    STARTED --> COMPLETED: driver completes
    REQUESTED --> CANCELLED: passenger cancels
    MATCHED --> CANCELLED: passenger cancels
    DRIVER_ARRIVED --> CANCELLED: passenger cancels
    MATCHED --> REQUESTED: driver cancels the trip
    DRIVER_ARRIVED --> REQUESTED: driver cancels the trip
    COMPLETED --> [*]
    CANCELLED --> [*]
```

| From | To | Actor | Precondition |
|---|---|---|---|
| REQUESTED | MATCHED | System / driver | Passes M1–M4 (same pickup, pool open, seats free, detour ≤ 2 km) |
| MATCHED | DRIVER_ARRIVED | Driver | Own vehicle's pool |
| DRIVER_ARRIVED | STARTED | Driver | ≥ 1 passenger; final fares locked (−20% if 2+ passengers) |
| STARTED | COMPLETED | Driver | — |
| REQUESTED, MATCHED, DRIVER_ARRIVED | CANCELLED | Passenger | Own ride (else 403); seats freed at once |
| MATCHED, DRIVER_ARRIVED | REQUESTED | Driver | Trip not started; passengers wait for another driver |

## Pool

```mermaid
stateDiagram-v2
    [*] --> MATCHED: first request accepted
    MATCHED --> DRIVER_ARRIVED
    DRIVER_ARRIVED --> STARTED
    STARTED --> COMPLETED
    MATCHED --> CANCELLED: driver cancels, or last passenger cancels
    DRIVER_ARRIVED --> CANCELLED: driver cancels, or last passenger cancels
```

Only a `MATCHED` pool accepts new passengers. Once the driver arrives, the group is fixed.

## Driver availability

`vehicles.is_online`. Going offline is refused while the vehicle has an active pool; accepting is
refused while offline. Both use the vehicle lock.
