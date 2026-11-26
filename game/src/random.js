// Garuda Skies — seeded random numbers (mulberry32).
// Written fresh from the prose spec. Deterministic: the same seed always
// produces the same sequence, so island dressing and gusts can be replayed.

export function createRandom(seed) {
  let state = seed >>> 0;

  // Core mulberry32 step: returns a float in [0, 1).
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    // Raw float in [0, 1).
    next,
    // Float in [min, max).
    range(min, max) {
      return min + next() * (max - min);
    },
    // Whole number in [min, max] (both ends inclusive).
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },
    // One element picked at random from the array.
    pick(array) {
      return array[Math.floor(next() * array.length)];
    },
    // True with probability p (0..1).
    chance(p) {
      return next() < p;
    },
    // A shuffled copy of the array (Fisher-Yates); the original is untouched.
    shuffle(array) {
      const copy = array.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
      return copy;
    },
  };
}
