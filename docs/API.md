# Inventory API v3
Base `http://localhost:3002/api/inventory`. `GET /health` outside base: liveness, instance ID, port. `X-Instance-ID` on all responses; JSON catalogue shape unchanged. Every POST/PATCH uses application/json (send `{}` for confirm/release). JWT = shared access JWT. Internal = private Inventory service bearer token, never browser-visible. Admin = JWT role admin.

| Method/path | Auth | Inputs / purpose |
|---|---|---|
| GET /zones | JWT | List zones |
| GET /zones/:id | JWT | Zone detail |
| POST /zones | Admin | zone_id, zone_name, optional description |
| PATCH /zones/:id | Admin | zone_name, description |
| DELETE /zones/:id | Admin | Only empty zone |
| GET /spots | Internal | Optional zone_id, spot_type; exact legacy catalogue |
| GET /spots/:id | JWT | Spot details, no hold records |
| POST /spots | Admin | spot_id, zone_id, spot_type, active boolean (default true) |
| PATCH /spots/:id | Admin | spot_type and/or active; guarded by live schedule |
| DELETE /spots/:id | Admin | Only unused spot, no hold history |
| GET /search | JWT | zone_id, spot_type, active=true/false, q, sort=asc/desc |
| GET /alternatives | JWT | zone_id, spot_type, min_active; catalogue-only suggestions |
| GET /availability | JWT | start_at, end_at, optional zone_id, spot_type, spot_id |
| GET /capacity | JWT | optional at (UTC); per-zone counts and alerts |
| GET /internal/availability | Internal | Same as availability for Allocation |
| GET /internal/capacity | Internal | Legacy capacity snapshot or interval-based pricing occupancy |
| GET /internal/spots/:id | Location token | Location validation for incident service |
| GET /internal/zones/:id | Location token | Location validation for incident service |
| POST /holds | Internal | spot_id, hold_id, start_at, end_at; optional expected_zone_id, expected_spot_type |
| GET /holds/:spot/:hold | Internal | Hold status/reconciliation |
| POST /holds/:spot/:hold/confirm | Internal | {} |
| POST /holds/:spot/:hold/release | Internal | {} |
| POST /holds/:spot/:hold/extend | Internal | end_at; increase live confirmed interval only |

Existing private `GET /spots?zone_id=zone_1&spot_type=standard` returns exactly `{"data":[{"spot_id":"A1","zone_id":"zone_1","spot_type":"standard","active":true}]}`. Includes all matching records, inactive and booked. Empty `{"data":[]}`. Other successes `{"success":true,"data":...}`; zone/spot creation 201, hold operations 200 including replay. Errors `{"success":false,"error":{"code":"...","message":"..."}}`.

Times use UTC ISO 8601 with seconds, optional milliseconds, e.g. `2026-12-01T09:00:00Z`. Use future dates relative to test time. Intervals half-open [start,end); exact adjacency permitted. Availability is a snapshot, not a commitment. Response data contains start_at, end_at, checked_at and spots array. A hold starts in the future, expires 5 minutes after acquisition or at interval end (whichever is first). Hold ID stable per spot, 1–40 letters/digits/underscore/hyphen, caller-generated unique. Responses include spot_id, hold_id, start_at, end_at, original_end_at, expires_at, effective status HELD/CONFIRMED/RELEASED/EXPIRED/ENDED. Replay same ID and original interval returns active existing hold; expired/released ID cannot be reused. A confirm retries idempotently while confirmed and live. Release of terminal hold returns terminal state. Extend repeats same end idempotently while live; cannot shorten. A 503/timeout can be ambiguous; read same hold and retry/reconcile before another allocation.

Capacity: optional `at` current or future instant. total, active, inactive, by_type, held, booked, available, occupancy (held+booked), utilization_percent=100*occupancy/total; FULL when active >0 and no active spot free, HIGH at >=80% of total unless FULL, NORMAL otherwise, NO_ACTIVE_CAPACITY when active=0. These are booking-state estimates, not physical occupancy sensors. Threshold 80% and 5-minute lease are proposed defaults, not established team rules. Alerts are returned in API/dashboard; SNS not implemented. Scans are not atomic across spots. Cutover disabled: counts of catalogue still returned, booking metrics null and UNKNOWN; availability and holds return 503. Schedule data is never in browser catalogue/details.

400 validation, 401 credentials, 403 role/origin, 404 missing resource, 409 overlapping/expired/duplicate/concurrent conflict, 413 body limit, 415 media type, 429 rate limiting, 503 unavailable/unconfirmed/cutover/record limit. HS256 claims sub, role, priority, iss, aud, exp; shared values privately agreed. IDs/spot zone immutable. Proposed types standard, accessible, ev; agree with team. Service token is currently Allocation-scoped; do NOT give it to Thabit solely for location checks. Location reads can use JWT or a distinct optional INVENTORY_LOCATION_TOKEN for the two location endpoints; this token cannot call holds. See INTEGRATION.md.
### Expected zone and spot type validation

Hold creation accepts two optional fields: `expected_zone_id`
and `expected_spot_type`. Allocation should provide both fields
to prevent booking a spot using outdated catalogue information.

Inventory validates these fields against the current parking spot
record during the conditional-write operation. A mismatch returns
409 Conflict. Invalid field values return 400 Bad Request.

If the fields are omitted, the existing hold creation behavior
is preserved.
### Identifier limits

- Parking spot IDs: 1–64 characters.
- Zone IDs: 1–40 characters.
- Hold IDs: 1–40 characters.

Identifiers accept only letters, numbers, underscores and hyphens.
Parking spot IDs must be globally unique.
### Dynamic pricing occupancy

GET /api/inventory/internal/capacity

Requires the private Allocation service bearer token.

Required pricing query parameters:

- zone_id
- spot_type
- start_at
- end_at

Optional renewal exclusion parameters:

- exclude_spot_id
- exclude_hold_id

Both exclusion parameters must be supplied together.

Example request:

GET /api/inventory/internal/capacity?zone_id=zone_1&spot_type=standard&start_at=2026-12-01T09:00:00Z&end_at=2026-12-01T12:00:00Z

Example response:

```json
{
  "success": true,
  "data": {
    "zone_id": "zone_1",
    "spot_type": "standard",
    "active": 5,
    "booked": 3,
    "utilization_percent": 60
  }
}
```

Business rules:

- Only active spots matching the requested zone and type are counted.
- Each spot with at least one live confirmed booking overlapping
  the requested interval is counted once.
- Temporary holds, released bookings and ended bookings are excluded.
- Adjacent booking periods are not considered overlapping.
- Pricing utilization equals booked divided by active multiplied by 100.
- Zero active capacity returns zero utilization but does not indicate
  parking availability.
- Exclusion applies only to the matching spot ID and hold ID.
- Pricing occupancy is a snapshot, not an atomic booking guarantee.
- Allocation remains responsible for calculating the final price.
- Connected mode without verified cutover returns 503 CUTOVER_REQUIRED.

The existing internal capacity endpoint without pricing parameters,
including queries using only at, retains its original response structure.

The public capacity dashboard remains unchanged.