// PRNG determinista (mulberry32). El estado es un entero de 32 bits, así que
// se puede guardar y restaurar para reanudar la simulación exactamente.
export function createRng(seed = 1) {
  let state = seed >>> 0;
  const rng = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => state;
  rng.setState = (s) => {
    state = s >>> 0;
  };
  return rng;
}
