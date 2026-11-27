// Run with k6, not Node.js.
// Same read-only workload for one and three workers.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const token = __ENV.INVENTORY_TOKEN;
const base = __ENV.BASE_URL || 'http://127.0.0.1:8080';

const zone = __ENV.TEST_ZONE_ID;
const spot = __ENV.TEST_SPOT_ID;

if (!token) {
  throw new Error('Set INVENTORY_TOKEN privately.');
}

if (!zone || !spot) {
  throw new Error('Set TEST_ZONE_ID and TEST_SPOT_ID.');
}

// Track successful requests handled by each worker.
const served = {
  'inventory-1': new Counter('served_by_inventory_1'),
  'inventory-2': new Counter('served_by_inventory_2'),
  'inventory-3': new Counter('served_by_inventory_3')
};

const limited = new Counter('rate_limited_429');

export const options = {
  stages: [
    { duration: '20s', target: 10 },
    { duration: '30s', target: 10 },
    { duration: '20s', target: 25 },
    { duration: '30s', target: 25 },
    { duration: '10s', target: 0 }
  ],

  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
    checks: ['rate>0.95']
  }
};

export default function () {
  const url = `${base}/api/inventory/spots?zone_id=${encodeURIComponent(zone)}&spot_type=standard`;

  const r = http.get(url, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    timeout: '3500ms'
  });

  limited.add(r.status === 429 ? 1 : 0);

  const instance = r.headers['X-Instance-Id'];

  if (served[instance] && r.status === 200) {
    served[instance].add(1);
  }

  check(r, {
    'catalogue returns 200': x => x.status === 200,

    'known inventory instance': x =>
      Object.keys(served).includes(
        x.headers['X-Instance-Id']
      ),

    'valid catalogue': x => {
      try {
        const b = x.json();

        return Array.isArray(b.data) &&
          b.data.some(s =>
            s.spot_id === spot &&
            s.zone_id === zone &&
            s.spot_type === 'standard' &&
            typeof s.active === 'boolean'
          );
      } catch {
        return false;
      }
    }
  });

  sleep(0.2);
}