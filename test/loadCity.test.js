import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { loadCity } from '../src/city/loadCity.js';

test('loads municipal Dbizi stations when the city data has no OSM stations', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    if (url === CONFIG.dataUrl) {
      return { ok: true, json: async () => ({ bicycleStations: [] }) };
    }
    if (url === CONFIG.municipalDataUrl) {
      return {
        ok: true,
        json: async () => ({
          layers: { stations: [{ id: 4, name: 'Andia', x: -110.5, z: -246 }] },
        }),
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const city = await loadCity();
  assert.equal(city.bicycleStations.length, 1);
  assert.equal(city.bicycleStations[0].id, 'municipal/4');
  assert.deepEqual(requests, [CONFIG.dataUrl, CONFIG.municipalDataUrl]);
});
