# State Machines

Any transition not listed here is rejected with `InvalidTransition`. Every transition writes an event row
(`pool_events` or `ride_request_events`) in the same transaction.

## Pool

```mermaid
stateDiagram-v2
    [*] --> ACCEPTED: driver accepts first request
    ACCEPTED --> DRIVER_ARRIVED: driver at first pickup stop
    DRIVER_ARRIVED --> STARTED: driver starts
    STARTED --> STARTED: next stop / pickup / drop-off
    STARTED --> COMPLETED: last passenger dropped off (automatic)
    ACCEPTED --> CANCELLED: driver cancels, or empty (automatic)
    DRIVER_ARRIVED --> CANCELLED: driver cancels, or empty (automatic)
    COMPLETED --> [*]
    CANCELLED --> [*]
```

| State | Joins allowed? |
|---|---|
| ACCEPTED, DRIVER_ARRIVED | Yes, if shared, on the same route and direction, seats free |
| STARTED | Only for pickups ahead of `current_stop_index`, if shared and seats free |
| COMPLETED, CANCELLED | No |

**Start requires:** at least one passenger IN_PROGRESS and no MATCHED passenger still waiting at the
current stop. Unconfirmed holds are released on start.

## Ride request (passenger)

```mermaid
stateDiagram-v2
    [*] --> REQUESTED: passenger requests (fare locked)
    REQUESTED --> HELD: fits a shared pool (Tier 2)
    REQUESTED --> MATCHED: driver accepts
    REQUESTED --> CANCELLED: passenger cancels
    REQUESTED --> EXPIRED: 5 minutes, nobody accepted (Tier 2)
    HELD --> MATCHED: driver confirms
    HELD --> REQUESTED: rejected / hold timeout / start / pool cancelled
    HELD --> CANCELLED: passenger cancels
    MATCHED --> IN_PROGRESS: picked up
    MATCHED --> NO_SHOW: absent at pickup (Tier 2)
    MATCHED --> CANCELLED: passenger cancels before pickup
    MATCHED --> REQUESTED: driver cancels pool before start
    IN_PROGRESS --> COMPLETED: dropped off
    COMPLETED --> [*]
    CANCELLED --> [*]
    EXPIRED --> [*]
    NO_SHOW --> [*]
```

Passenger-facing labels: **waiting** (REQUESTED, HELD) · **matched** (MATCHED) · **in progress**
(IN_PROGRESS) · **completed** · **cancelled** · **expired** · **no-show**.

A request returned to REQUESTED gets a fresh expiry time. Its locked fare does not change.

## Pool membership

```mermaid
stateDiagram-v2
    [*] --> HELD: system hold (Tier 2)
    [*] --> ACTIVE: driver accepts directly
    HELD --> ACTIVE: driver confirms
    HELD --> REJECTED: driver rejects
    HELD --> RELEASED: timeout, start, or pool cancelled
    ACTIVE --> ENDED: completed / cancelled / no-show / pool cancelled
```

Seats count toward `pools.seats_taken` while a membership is HELD or ACTIVE.

## Driver availability

`vehicles.is_online`: OFFLINE ⇄ ONLINE. Going offline is rejected while the vehicle has an active pool.
Changes take the vehicle lock.
