// world.js — terrain, sky palettes and ring layouts for Operasi Garuda Senja.
// Every mission flies over a heightfield built from seeded value noise, so the
// same mission always shows the same mountains, dunes, islands or city blocks.

export function hashNoise(x, z, seed) {
  let n = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hashNoise(xi, zi, seed), b = hashNoise(xi + 1, zi, seed);
  const c = hashNoise(xi, zi + 1, seed), d = hashNoise(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z, seed, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(x * freq, z * freq, seed + i * 13) * amp;
    norm += amp; amp *= 0.5; freq *= 2.1;
  }
  return sum / norm;
}

// Height of the ground in metres at world (x, z) for a mission id.
export function terrainHeight(x, z, mission) {
  if (mission === 'm2') {
    const dunes = fbm(x * 0.004, z * 0.004, 7, 4);
    const ridge = Math.pow(1 - Math.abs(fbm(x * 0.0016, z * 0.0016, 21, 3) * 2 - 1), 2);
    return 18 + dunes * 55 + ridge * 70;
  }
  if (mission === 'm3') {
    const isle = fbm(x * 0.0022, z * 0.0022, 31, 4);
    const peak = Math.pow(Math.max(0, isle - 0.52) / 0.48, 1.6);
    return -14 + peak * 95 + fbm(x * 0.01, z * 0.01, 33, 2) * 4;
  }
  if (mission === 'm4') {
    return 0; // flat city plain; towers are buildings, not terrain
  }
  // m1: green mountain valley — a deep, flat corridor along the winding
  // valley floor, with high peaks only well away from the flight path.
  const valley = Math.exp(-Math.pow((x - valleyCentre(z)) / 300, 2));
  const mountains = fbm(x * 0.002, z * 0.002, 3, 5);
  const sharp = Math.pow(fbm(x * 0.006, z * 0.006, 9, 3), 2);
  return 22 + mountains * 95 * (1 - valley * 0.88) + sharp * 38 * (1 - valley * 0.7) - valley * 16;
}

function valleyCentre(z) {
  return Math.sin(z * 0.0011) * 320 + Math.sin(z * 0.00031) * 500;
}

export function waterLevel(mission) {
  return mission === 'm3' ? 0 : -9999;
}

// City towers for m4: {x, z, w, d, h} boxes along the flight corridor.
export function cityBuildings() {
  const list = [];
  let s = 1234;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 46; i++) {
    const z = 300 + i * 170 + rnd() * 90;
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (180 + rnd() * 620);
    list.push({ x, z, w: 46 + rnd() * 60, d: 46 + rnd() * 60, h: 55 + rnd() * 75 });
  }
  return list;
}

// Ring course for a mission: a winding path of target rings the pilot must fly through.
// In the mountain valley the rings follow the valley floor, so the corridor
// stays flyable; elsewhere they wander the open terrain.
export function buildRings(mission) {
  const rings = [];
  const count = mission === 'm1' ? 6 : mission === 'm2' ? 8 : mission === 'm3' ? 7 : 8;
  let x = 0, z = 200;
  for (let i = 0; i < count; i++) {
    z += 620 + (hashNoise(i, 5, 77) * 260);
    if (mission === 'm1') {
      x = valleyCentre(z) + (hashNoise(i, 9, 78) - 0.5) * 360;
    } else {
      x += (hashNoise(i, 9, 78) - 0.5) * 900;
      x = Math.max(-900, Math.min(900, x));
    }
    const ground = terrainHeight(x, z, mission);
    const y = ground + 70 + hashNoise(i, 3, 79) * 60;
    rings.push({ x, y, z, r: 34 });
  }
  // Final ring sits over the mission's runway strip.
  const last = rings[rings.length - 1];
  const fx = mission === 'm1' ? valleyCentre(last.z + 700) : last.x * 0.5;
  rings.push({ x: fx, y: terrainHeight(fx, last.z + 700, mission) + 55, z: last.z + 700, r: 40, final: true });
  return rings;
}

// Colour ramp for one ground sample, by height and mission.
export function groundColor(h, x, z, mission, dist) {
  let c;
  if (mission === 'm2') {
    c = h < 40 ? [196, 148, 84] : h < 80 ? [214, 172, 104] : h < 120 ? [188, 138, 82] : [150, 104, 66];
  } else if (mission === 'm3') {
    if (h <= 0) {
      const shimmer = hashNoise(Math.floor(x / 14), Math.floor(z / 14), 55) * 14;
      c = [10 + shimmer, 26 + shimmer, 62 + shimmer * 2];
    } else if (h < 30) c = [214, 196, 150];
    else if (h < 60) c = [74, 128, 74];
    else c = [96, 104, 88];
  } else if (mission === 'm4') {
    const block = (Math.floor(x / 120) + Math.floor(z / 120)) % 2 === 0;
    c = block ? [38, 40, 52] : [30, 32, 44];
  } else {
    c = h < 45 ? [86, 132, 80] : h < 90 ? [62, 110, 66] : h < 140 ? [104, 96, 74] : h < 185 ? [122, 116, 108] : [232, 236, 240];
  }
  return c;
}

// Sky, fog and light for each mission.
export function missionPalette(mission) {
  if (mission === 'm2') return {
    skyTop: '#f7b733', skyMid: '#e88f4a', skyBot: '#c97e4e', sun: '#fff3c4',
    fog: [222, 158, 96], sunX: 0.72, sunY: 0.2, night: false,
  };
  if (mission === 'm3') return {
    skyTop: '#050914', skyMid: '#0d1b3d', skyBot: '#1b2f5e', sun: '#f4f1de',
    fog: [13, 22, 46], sunX: 0.24, sunY: 0.16, night: true,
  };
  if (mission === 'm4') return {
    skyTop: '#070a18', skyMid: '#131a33', skyBot: '#232a4d', sun: '#e8ecff',
    fog: [16, 20, 42], sunX: 0.8, sunY: 0.14, night: true,
  };
  return {
    skyTop: '#3f7fd0', skyMid: '#8fc3ee', skyBot: '#d9ecfa', sun: '#fff8d6',
    fog: [168, 198, 228], sunX: 0.68, sunY: 0.18, night: false,
  };
}

export function fogBlend(rgb, fog, t) {
  const k = Math.max(0, Math.min(1, t));
  return [rgb[0] + (fog[0] - rgb[0]) * k, rgb[1] + (fog[1] - rgb[1]) * k, rgb[2] + (fog[2] - rgb[2]) * k];
}
