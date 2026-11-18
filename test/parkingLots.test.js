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
    p.tick(23 * 3600);
    for (const [id, price] of Object.entries(prices)) p.setPrice(id, price);
    p.tick(86400 + 6 * 3600);
    p.tick(86400 + 10 * 3600);
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

test('expensive parkings make people leave the car for the bus, the bike or walking', async () => {
  const fs = await import('node:fs');
  const { SimEngine } = await import('../src/core/engine.js');
  const { withBikeStations } = await import('../src/bikes/sharing.js');
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/city.json', import.meta.url), 'utf8'));
  withBikeStations(data, JSON.parse(fs.readFileSync(new URL('../public/data/municipal.json', import.meta.url), 'utf8')));
  const engine = new SimEngine({ data });
  const minute = () => {
    engine.environmentMinute = null;
    engine.updateEnvironment();
    return { cars: engine.carFactor, bus: engine.buses.extraDemand, bikes: engine.bikes.extraDemand, premium: engine.lots.pricePremium() };
  };
  // Las tarifas se aplican a las 0:00 del día siguiente.
  const tomorrow = () => engine.lots.applyTariffs((engine.lots.day + 1) * 86400 + 12 * 3600);
  engine.lots.applyTariffs(engine.simTime);
  const base = minute();
  assert.equal(base.premium, 0);
  for (const l of engine.lots.lots) engine.lots.setPrice(l.id, P.basePrice * 2);
  assert.equal(minute().premium, 0, 'hoy sigue la tarifa de hoy');
  tomorrow();
  const dear = minute();
  assert.ok(Math.abs(dear.premium - 1) < 1e-9);
  assert.ok(Math.abs(dear.cars / base.cars - (1 - P.shiftPerPremium)) < 1e-6, `${base.cars} -> ${dear.cars}`);
  assert.ok(dear.bus > base.bus && dear.bikes > base.bikes);
  for (const l of engine.lots.lots) engine.lots.setPrice(l.id, P.maxPrice);
  tomorrow();
  assert.ok(Math.abs(minute().cars / base.cars - (1 - P.maxShift)) < 1e-6, 'con un tope');
  // Más baratos que el precio base: no hay más coches.
  for (const l of engine.lots.lots) engine.lots.setPrice(l.id, P.minPrice);
  tomorrow();
  assert.equal(minute().cars, base.cars);
});

test('a tariff only changes at midnight, can have time bands and is kept in a snapshot', () => {
  const p = new ParkingLots(lots(), { getParams: () => ({ scenario: 'weekday' }) });
  p.tick(10 * 3600);
  p.setPrice('A', 3, [{ from: '17:00', to: '22:00', price: 5 }]);
  p.tick(18 * 3600);
  assert.equal(p.price[p.index.get('A')], P.basePrice, 'hoy, la de hoy');
  assert.deepEqual(p.tariffOf('A').tomorrow, { price: 3, schedule: [{ from: '17:00', to: '22:00', price: 5 }] });
  p.tick(86400 + 9 * 3600);
  assert.equal(p.price[p.index.get('A')], 3);
  const copy = new ParkingLots(lots(), { getParams: () => ({ scenario: 'weekday' }) });
  copy.restore(JSON.parse(JSON.stringify(p.serialize())));
  p.tick(86400 + 18 * 3600);
  copy.tick(86400 + 18 * 3600);
  assert.equal(p.price[p.index.get('A')], 5, 'en la franja');
  assert.deepEqual(copy.state(), p.state());
  // Sigue igual los días siguientes hasta que se cambie.
  p.tick(2 * 86400 + 9 * 3600);
  assert.equal(p.price[p.index.get('A')], 3);
  assert.throws(() => p.setPrice('A', 2, [{ from: '22:00', to: '17:00', price: 4 }]), /franja/);
  assert.throws(() => p.setPrice('A', 2, [{ from: '25:00', to: '26:00', price: 4 }]), /Hora/);
});
