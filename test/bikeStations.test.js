import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBikeStations } from '../scripts/bike-stations.mjs';
import { bikeAvailabilityColor, municipalBikeStations, withBikeStations } from '../src/bikes/sharing.js';
import { BikeNetwork } from '../src/bikes/bikeNetwork.js';
import { CONFIG } from '../src/config.js';

const project = (lat, lon) => [lon * 10, lat * -10];
const round1 = (value) => Math.round(value * 10) / 10;

test('extracts OSM bicycle stations with coordinates and capacity metadata', () => {
  const stations = extractBikeStations([
    {
      type: 'node', id: 21, lat: 43.3, lon: -1.9,
      tags: { amenity: 'bicycle_rental', name: 'Centro', capacity: '16', operator: 'Dbizi' },
    },
    {
      type: 'way', id: 22, center: { lat: 43.31, lon: -1.91 },
      tags: { bicycle_rental: 'station', network: 'Dbizi' },
    },
    { type: 'node', id: 23, tags: { amenity: 'bicycle_rental' } },
  ], project, round1);

  assert.deepEqual(stations, [
    {
      id: 'node/21', source: 'osm', name: 'Centro', x: -19, z: -433,
      capacity: 16, estimatedCapacity: false, operator: 'Dbizi', network: '',
    },
    {
      id: 'way/22', source: 'osm', name: 'Dbizi', x: -19.1, z: -433.1,
      capacity: 12, estimatedCapacity: true, operator: '', network: 'Dbizi',
    },
  ]);
});

test('adapts municipal Dbizi stations when OSM data is unavailable', () => {
  assert.deepEqual(municipalBikeStations([
    { id: 7, name: 'Udaletxea', x: -422.6, z: -348.8 },
    { id: 8, name: 'Sin coordenadas' },
  ]), [{
    id: 'municipal/7',
    source: 'municipal',
    name: 'Udaletxea',
    x: -422.6,
    z: -348.8,
    capacity: 12,
    estimatedCapacity: true,
    operator: 'Dbizi',
    network: 'Dbizi',
  }]);
});

test('availability colours and municipal fallback', () => {
  assert.equal(bikeAvailabilityColor(0, 10), 0xe74c3c);
  assert.equal(bikeAvailabilityColor(3, 10), 0xf1c40f);
  assert.equal(bikeAvailabilityColor(8, 10), 0x2ecc71);
  const osm = { bicycleStations: [{ id: 'node/1' }] };
  assert.equal(withBikeStations(osm, { layers: { stations: [{ id: 1, x: 0, z: 0 }] } }).bicycleStations[0].id, 'node/1');
  const empty = withBikeStations({}, { layers: { stations: [{ id: 1, x: 0, z: 0 }] } });
  assert.equal(empty.bicycleStations[0].id, 'municipal/1');
  assert.deepEqual(withBikeStations({}, null).bicycleStations, []);
});

const stations = Array.from({ length: 6 }, (_, i) => ({ id: `node/${i}`, name: `E${i}`, x: i * 50, z: 0, capacity: 10 }));
const newNetwork = (start = 0) => {
  let now = start;
  const net = new BikeNetwork({ stations, getSimTime: () => now, getParams: () => ({ scenario: CONFIG.traffic.scenario }) });
  net.run = (to) => { now = to; net.tick(to); };
  return net;
};
const total = (net) => net.state().stations.reduce((n, s) => n + s.available, 0) + net.inUse;

test('pedestrians take and return bikes on their own, conserving the fleet', () => {
  const net = newNetwork();
  const fleet = total(net);
  let maxInUse = 0;
  for (let t = 3600; t <= 24 * 3600; t += 3600) {
    net.run(8 * 3600 + t);
    maxInUse = Math.max(maxInUse, net.inUse);
    assert.equal(total(net), fleet);
    for (const s of net.state().stations) assert.ok(s.available >= 0 && s.available <= s.capacity);
  }
  assert.ok(maxInUse > 0, 'someone took a bike');
});

test('the bike network is deterministic and resumes from a snapshot', () => {
  const a = newNetwork();
  const b = newNetwork();
  a.run(12 * 3600);
  b.run(12 * 3600);
  assert.deepEqual(a.state(), b.state());
  const resumed = newNetwork(12 * 3600);
  resumed.restore(JSON.parse(JSON.stringify(a.serialize())));
  a.run(15 * 3600);
  resumed.run(15 * 3600);
  assert.deepEqual(resumed.state(), a.state());
});

test('tracked stations produce a record per interval with takes and returns', () => {
  const net = newNetwork();
  net.setTracked('node/0', true);
  net.setTracked('unknown', true);
  net.run(10 * 3600);
  const interval = CONFIG.bicycles.intervalSeconds;
  assert.equal(net.pending.length, (10 * 3600) / interval + 1); // incluye el instante 0
  const [first] = net.pending;
  assert.equal(first.station_id, 'node/0');
  assert.equal(first.free_docks, first.capacity - first.bikes);
  assert.ok(net.pending.every((r) => r.takes >= 0 && r.returns >= 0));
});
