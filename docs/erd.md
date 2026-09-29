# Database Design (ERD)

PostgreSQL. Money is stored as integer paisa. Times are `timestamptz` (UTC). Primary keys are UUIDs.
Columns marked *(planned)* are added by their own migration when that feature is built.

```mermaid
erDiagram
    users ||--o{ sessions : has
    users ||--o| vehicles : drives
    users ||--o{ ride_requests : requests
    zones ||--o{ zone_distances : "from / to"
    zones ||--o{ ride_requests : "pickup / drop-off"
    zones ||--o{ pools : "pickup zone"
    vehicles ||--o{ pools : runs
    pools ||--o{ pool_members : contains
    ride_requests ||--o{ pool_members : "holds seats in"
    ride_requests ||--o{ ride_events : history
    pools |o--o{ ride_events : "context"

    users {
        uuid id PK
        text name
        text email "unique, stored lower case"
        text password_hash
        enum role "PASSENGER | DRIVER"
    }
    sessions {
        uuid id PK
        uuid user_id FK
        text token_hash "unique (SHA-256)"
        timestamptz expires_at
    }
    vehicles {
        uuid id PK
        uuid driver_id FK "unique: one vehicle per driver"
        text name "Bullet"
        int seat_capacity "CHECK > 0"
        bool is_online
    }
    zones {
        uuid id PK
        text code "unique, e.g. BAN"
        text name "unique"
    }
    zone_distances {
        uuid from_zone_id PK, FK
        uuid to_zone_id PK, FK
        int km "CHECK > 0, from <> to"
    }
    pools {
        uuid id PK
        uuid vehicle_id FK
        uuid pickup_zone_id FK
        enum status "MATCHED..COMPLETED | CANCELLED"
        int seat_capacity "copied from vehicle"
        int seats_taken "CHECK 0..seat_capacity"
        timestamptz started_at
        timestamptz ended_at
    }
    ride_requests {
        uuid id PK
        uuid passenger_id FK
        uuid pickup_zone_id FK
        uuid dropoff_zone_id FK
        int seats "CHECK 1..3"
        enum status
        int distance_km
        int estimated_fare_paisa "solo fare"
        int final_fare_paisa "locked at STARTED"
    }
    pool_members {
        uuid id PK
        uuid pool_id FK
        uuid ride_request_id FK
        int seats
        timestamptz joined_at
        timestamptz left_at "null while holding seats"
    }
    ride_events {
        uuid id PK
        uuid ride_request_id FK
        uuid pool_id FK "nullable"
        enum from_status
        enum to_status
        uuid actor_user_id FK "null = system"
        text reason
        timestamptz created_at
    }
```

## Tables

| Table | Why it exists |
|---|---|
| `users` | Passengers and drivers in one table with a `role`. |
| `sessions` | Server-side login sessions; only a SHA-256 hash of the token is stored. |
| `vehicles` | A driver's vehicle (Bullet, 3 seats). Its row is the **lock** for every seat change. `is_online` lives here so going online/offline uses the same lock. |
| `zones`, `zone_distances` | The 14 Dhaka zones and whole-km distances in both directions. |
| `pools` | One trip of one vehicle from one pickup zone. Holds the seat counter the CHECK protects. |
| `ride_requests` | One passenger's request: zones, seats, status, the solo estimate and the final fare. |
| `pool_members` | Pool membership: which request holds how many seats in which pool (`left_at` set on cancel). |
| `ride_events` | Append-only status history of every request (actor, reason, time). |

Not included on purpose: payments (cash only), ratings.

## Constraints and indexes

| Object | Definition | Protects |
|---|---|---|
| CHECK | `pools.seats_taken BETWEEN 0 AND seat_capacity` | capacity is never exceeded |
| CHECK | `pools.status <> 'REQUESTED'` | valid pool states |
| CHECK | `ride_requests.seats BETWEEN 1 AND 3`, `pickup_zone_id <> dropoff_zone_id`, fares ≥ 0 | valid requests |
| CHECK | `vehicles.seat_capacity > 0`, `zone_distances.km > 0`, `from <> to` | valid data |
| Unique + CHECK | `users.email` unique, `CHECK (email = lower(email))` | one account per email |
| Unique | `vehicles.driver_id` | one vehicle per driver |
| Partial unique | `pools(vehicle_id) WHERE status IN (MATCHED, DRIVER_ARRIVED, STARTED)` | one active pool per vehicle |
| Partial unique | `ride_requests(passenger_id) WHERE status IN (REQUESTED, MATCHED, DRIVER_ARRIVED, STARTED)` | one active ride per passenger |
| Partial unique | `pool_members(ride_request_id) WHERE left_at IS NULL` | a request is in at most one pool |
| Index | `ride_requests(status, created_at)`, `pools(status, pickup_zone_id)`, `ride_events(ride_request_id, created_at)` | driver list, auto-join lookup, history |

CHECK constraints and partial unique indexes are written by hand in migration SQL (Prisma's schema language cannot express them) and listed here so the schema is fully documented.
