import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { ParkingLots } from '../src/city/parkingLots.js';

const P = CONFIG.parking;
const NOON = 12 * 3600;
// Tres parkings cerca (a menos de nearMeters) y uno lejos.
const lots = () => [
  { id: 'A', name: 'A', x: 0, z: 0, capacity: 100, bias: 1 },
  { id: 'B', name: 'B', x: 400, z: 0, capacity: 100, bias: 1 },
  { id: 'C', name: 'C', x: 0, z: 400, capacity: 100, bias: 1 },
  { id: 'L', name: 'Lejos', x: 5000, z: 5000, capacity: 100, bias: 1 },
];

test('parkings fill and empty with the city demand and keep their state in a snapshot', () => {
  const p = new ParkingLots(lots(), { getParams: () => ({ scenario: 'weekday' }) });
  p.tick(3 * 3600);
  const night = p.occupancy('A');
  p.tick(NOON);
  assert.ok(p.occupancy('A') > night, `${night} -> ${p.occupancy('A')}`);
  const copy = new ParkingLots(lots(), { getParams: () => ({ scenario: 'weekday' }) });
  copy.restore(JSON.parse(JSON.stringify(p.serialize())));
  assert.deepEqual(copy.state(), p.state());
});

test('a pricier parking sends drivers to its neighbours; raising every price changes nothing', () => {
  const run = (prices) => {
    const p = new ParkingLots(lots(), { getParams: () => ({ scenario: 'weekday' }) });
    for (const [id, price] of Object.entries(prices)) p.setPrice(id, price);
    p.tick(6 * 3600);
    p.tick(10 * 3600);
    return Object.fromEntries(p.state().map((l) => [l.id, l.occupied]));
  };
  const base = run({});
  const dear = run({ A: P.maxPrice });
  assert.ok(dear.A < base.A, `A ${base.A} -> ${dear.A}`);
  assert.ok(dear.B > base.B && dear.C > base.C);
  assert.equal(dear.L, base.L, 'el lejano no es de la zona');
  const all = run({ A: 4, B: 4, C: 4, L: 4 });
  for (const id of ['A', 'B', 'C', 'L']) assert.ok(Math.abs(all[id] - base[id]) < 1e-6, id);
  assert.throws(() => new ParkingLots(lots()).setPrice('A', 99), /precio/);
  assert.throws(() => new ParkingLots(lots()).setPrice('X', 2), /desconocido/);
});

test('when the parkings of an event area are full, drivers circle around looking for a space', () => {
  const event = [{ id: 'e', phase: 'arrive', x: 0, z: 0, weight: 1 }];
  const p = new ParkingLots(lots(), { getParams: () => ({ scenario: 'weekday' }), attractorsAt: () => event });
  p.tick(NOON);
  p.tick(NOON + 3 * 3600);
  assert.ok(p.fullCount() >= 1);
  assert.ok(p.searching > 0, `buscando: ${p.searching}`);
});
