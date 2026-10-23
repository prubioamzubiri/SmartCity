import test from 'node:test';
import assert from 'node:assert/strict';
import { ParkingTracker } from '../src/sensors/parkingTracker.js';

const lots = [
  { id: 'A', name: 'Parking A', capacity: 100 },
  { id: 'B', name: 'Parking, "B"', capacity: 50 },
];

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}

function make(storage = memoryStorage(), start = 0) {
  return new ParkingTracker({ lots, occupancyOf: (lot) => (lot.id === 'A' ? 0.5 : 0.2), getSimTime: () => start, storage });
}

test('only selected parkings are sampled, once per interval boundary', () => {
  const t = make();
  t.setTracked('A', true);
  t.setTracked('missing', true);
  t.tick(0);
  t.tick(299);
  assert.equal(t.records.length, 1);
  t.tick(900);
  assert.deepEqual(t.records.map((r) => r.timestamp.slice(11)), ['00:00:00', '00:05:00', '00:10:00', '00:15:00']);
  const r = t.records[0];
  assert.deepEqual([r.parking_id, r.capacity, r.occupied, r.free, r.occupancy_pct], ['A', 100, 50, 50, 50]);
  assert.equal(t.pending.length, 4);
});

test('nothing is recorded when no parking is tracked', () => {
  const t = make();
  t.tick(3600);
  assert.equal(t.records.length, 0);
});

test('selection persists, ignoring unknown ids and corrupt data', () => {
  const storage = memoryStorage();
  const t = make(storage);
  t.setAll(true);
  t.setTracked('B', false);
  const restored = make(storage);
  restored.load();
  assert.deepEqual([...restored.tracked], ['A']);
  storage.setItem('smartcity.parkings', JSON.stringify({ tracked: ['A', 'zzz'] }));
  const other = make(storage);
  other.load();
  assert.deepEqual([...other.tracked], ['A']);
  storage.setItem('smartcity.parkings', '{oops');
  const broken = make(storage);
  broken.load();
  assert.equal(broken.tracked.size, 0);
});

test('interval change realigns sampling and CSV escapes values', () => {
  const t = make(memoryStorage(), 100);
  t.setAll(true);
  t.setIntervalSeconds(900, 100);
  t.tick(900);
  assert.equal(t.records.length, 2);
  const csv = t.recordsCsv().split('\n');
  assert.match(csv[0], /^timestamp,weekday,parking_id/);
  assert.ok(csv[2].includes('"Parking, ""B"""'));
});
