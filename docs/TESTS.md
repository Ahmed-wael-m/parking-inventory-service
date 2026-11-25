# Test status (v3)
Actual build-environment result: `node --test test/service.test.js test/schedule.test.js test/proxy.test.js` = 20 passed, 0 failed (7 core, 12 schedule, 1 proxy). Core/schedule tests use a mock in-memory repository. Proxy uses three stub HTTP workers. These are not Floci or end-to-end tests. JavaScript syntax checked separately. Full Express API tests not executed; dependencies unavailable here. No real DB, Lambda, frontend, Docker, k6 or team integration tests executed.

Run `npm.cmd test` after installing dependencies; includes 13 HTTP cases plus the 20 tests above. `npm.cmd run test:db` uses random temporary tables and two independent DynamoDB clients: duplicate spot, parent counts, competing holds (one wins, one 409), confirmation visible across clients, guarded deactivation and release. Stop if Floci does not implement correct conditional/transaction semantics. Record expected and actual independently. Run `npm.cmd run test:proxy` for proxy only.

| Security / functional test | Expected | Actual in build |
|---|---|---|
| Invalid/missing/expired JWT | 401 | HTTP pending |
| Wrong algorithm / signature | 401 | HTTP pending |
| Student attempts admin mutation | 403 | HTTP pending |
| JWT or bad token calls holds | 401 | HTTP pending |
| Forbidden origin | 403 | HTTP pending |
| Invalid date/interval | 400 | Mock passed |
| Oversize request | 413 | HTTP pending |
| Rate limit | 429 | HTTP pending |
| Duplicate ID | 409 | Mock passed |
| Two overlapping holds | One succeeds, one 409 | Mock passed; Floci pending |
| Hold versus deactivation | Only one succeeds | Mock passed; Floci pending |
| Expired hold confirmation | 409 | Mock passed |
| Confirmed hold stays blocked | until interval end/release | Mock passed |
| Capacity near full/full | HIGH/FULL | Mock passed |
| Retry same hold | no duplicate | Mock passed |
| Uncertain database failure | 503, no blind retry | Mock passed |
| Missing cutover | 503 | Mock passed |
| IAM denied / CloudWatch ingestion | actual denial / actual logs | Pending emulator support |

Threats: unauthorized access, privilege escalation, forged JWT, internal token leakage, overlapping bookings, stale capacity, malformed input, denial of service, untrusted browser origin, secret leakage. Per-worker limiter is not distributed; raised limit for isolated load tests only. Use verified HTTPS in deployment. No fabricated test or performance measurements.

Integration tests to perform with Youssef: legacy catalogue exact shape, candidate search, stable hold ID on retries, overlap across workers, confirmation and reservation persistence, failure after confirm before persistence, cancellation/release retry, extension conflict, expiry and waitlist promotion, pricing from occupancy, no legacy bypass. Verify timeout behavior under 3500ms for legacy catalogue. Thabit location validation uses read-only access agreed with team. These tests remain pending.
