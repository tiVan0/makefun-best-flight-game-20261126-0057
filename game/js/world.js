// world.js — terrain, sky palettes, ring layouts and airfields for Operasi Garuda Senja v3.
// Every mission flies over a heightfield built from seeded value noise, so the
// same mission always shows the same mountains, dunes, islands or city blocks.
// v3: runways under every final ring (plus takeoff and mid-course strips) with
// the ground flattened beneath them, continuous colour ramps with micro relief,
// richer city towers and street lights, rain and haze per mission.

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

function valleyCentre(z) {
  return Math.sin(z * 0.0011) * 320 + Math.sin(z * 0.00031) * 500;
}

// Raw height of the ground in metres at world (x, z) for a mission id,
// before the airfield flattening is applied.
export function rawTerrainHeight(x, z, mission) {
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
  // m1: green mountain valley — a deep corridor along the winding valley
  // floor, with high peaks only well away from the flight path, and a gentle
  // roll on the floor itself so the near ground is never a flat sheet.
  const valley = Math.exp(-Math.pow((x - valleyCentre(z)) / 300, 2));
  const mountains = fbm(x * 0.002, z * 0.002, 3, 5);
  const sharp = Math.pow(fbm(x * 0.006, z * 0.006, 9, 3), 2);
  const roll = fbm(x * 0.008, z * 0.008, 41, 2) * 6 * valley;
  return 22 + mountains * 95 * (1 - valley * 0.88) + sharp * 38 * (1 - valley * 0.7) - valley * 16 + roll;
}

export function waterLevel(mission) {
  return mission === 'm3' ? 0 : -9999;
}

// Ring course for a mission: a winding path of target rings the pilot must fly through.
// In the mountain valley the rings follow the valley floor, so the corridor
// stays flyable; elsewhere they wander the open terrain.
function courseRings(mission) {
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
    const ground = rawTerrainHeight(x, z, mission);
    const y = ground + 70 + hashNoise(i, 3, 79) * 60;
    rings.push({ x, y, z, r: 34 });
  }
  return rings;
}

// Centre, direction and height of a mission's landing strip, derived from
// the ring course: 1400 m past the last ring, on the course line — a long
// final leg, so the last ring and the strip leave room for a real approach.
export function stripCentre(mission) {
  const rings = courseRings(mission);
  const last = rings[rings.length - 1];
  const fx = mission === 'm1' ? valleyCentre(last.z + 1400) : last.x * 0.5;
  const fz = last.z + 1400;
  const dx = fx - last.x, dz = fz - last.z;
  const l = Math.hypot(dx, dz) || 1;
  // m3 flies over the sea: its strips are floating carrier decks 8 m above
  // the water, not ground strips — the sea floor sits metres below the
  // waterline, so a strip built on terrainHeight would sit underwater.
  return { x: fx, z: fz, dir: { x: dx / l, z: dz / l }, h: mission === 'm3' ? 8 : rawTerrainHeight(fx, fz, mission) };
}

// Ring course for a mission, with the final ring hung on the extended
// centreline 800 m before the landing strip, so the pilot crosses it already
// lined up for the glidepath instead of overflying the strip at 55 m.
export function buildRings(mission) {
  const rings = courseRings(mission);
  const c = stripCentre(mission);
  const rx = c.x - c.dir.x * 800, rz = c.z - c.dir.z * 800;
  const ry = Math.max(c.h, rawTerrainHeight(rx, rz, mission)) + 55;
  rings.push({ x: rx, y: ry, z: rz, r: 40, final: true });
  return rings;
}

// Airfields: one takeoff strip at the start, one mid-course strip and one
// landing strip 1400 m past the last ring. Each strip is {cx, cz, dir, len, w, h}.
// The final ring hangs on the landing strip's extended centreline, 800 m out.
const stripCache = new Map();
export function missionStrips(mission) {
  if (stripCache.has(mission)) return stripCache.get(mission);
  const rings = courseRings(mission);
  const c = stripCentre(mission);
  const mid = rings[3];
  const midPrev = rings[2];
  const midNext = rings[4];
  const dirBetween = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  };
  // m3's strips are carrier decks floating 8 m above the sea (see
  // stripCentre): deck strips never flatten the sea floor under them.
  const isDeck = mission === 'm3';
  const DECK_H = 8;
  const strips = [
    { cx: 0, cz: 260, dir: { x: 0, z: 1 }, len: 620, w: 52, h: isDeck ? DECK_H : rawTerrainHeight(0, 260, mission), kind: 'takeoff', deck: isDeck },
    { cx: mid.x, cz: mid.z, dir: dirBetween(midPrev, midNext), len: 620, w: 52, h: isDeck ? DECK_H : rawTerrainHeight(mid.x, mid.z, mission), kind: 'mid', deck: isDeck },
    { cx: c.x, cz: c.z, dir: c.dir, len: 620, w: 52, h: c.h, kind: 'final', deck: isDeck },
  ];
  stripCache.set(mission, strips);
  return strips;
}

// The landing strip: the one under the final ring.
export function finalStrip(mission) {
  const strips = missionStrips(mission);
  return strips[strips.length - 1];
}

// Height of the ground in metres at world (x, z): the raw heightfield with
// the ground eased flat underneath each airfield, so a runway never floats
// over a dune or sinks into a ridge. Flight, collision, rings and rendering
// all read this one function, so they can never disagree.
export function terrainHeight(x, z, mission) {
  const raw = rawTerrainHeight(x, z, mission);
  const strips = missionStrips(mission);
  let bestH = raw, bestK = 0;
  for (const s of strips) {
    if (s.deck) continue; // a deck floats; the sea floor under it stays put.
    const dx = x - s.cx, dz = z - s.cz;
    const along = dx * s.dir.x + dz * s.dir.z;
    const across = dx * (-s.dir.z) + dz * s.dir.x;
    const edge = Math.min(s.w / 2 + 90 - Math.abs(across), s.len / 2 + 90 - Math.abs(along));
    if (edge > 0) {
      const kk = Math.min(1, edge / 90);
      const ks = kk * kk * (3 - 2 * kk);
      if (ks > bestK) { bestK = ks; bestH = s.h; }
    }
  }
  return bestK > 0 ? raw + (bestH - raw) * bestK : raw;
}

// The floating deck (m3) a point sits over, or null. Decks are solid:
// flight reads stripGround, not terrainHeight, for ground contact.
export function deckAt(x, z, mission) {
  const strips = missionStrips(mission);
  for (const s of strips) {
    if (!s.deck) continue;
    const dx = x - s.cx, dz = z - s.cz;
    const along = dx * s.dir.x + dz * s.dir.z;
    const across = dx * (-s.dir.z) + dz * s.dir.x;
    if (Math.abs(along) <= s.len / 2 && Math.abs(across) <= s.w / 2) return s;
  }
  return null;
}

// Ground height for flight and collision: a deck's height over its rect,
// the heightfield everywhere else.
export function stripGround(x, z, mission) {
  const d = deckAt(x, z, mission);
  return d ? d.h : terrainHeight(x, z, mission);
}

// City towers for m4: {x, z, w, d, h, kind, seed} boxes along the flight corridor.
// Three landmarks rise far above the rest and carry spires.
export function cityBuildings() {
  const list = [];
  let s = 1234;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 60; i++) {
    const z = 300 + i * 135 + rnd() * 70;
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (180 + rnd() * 620);
    const landmark = i === 8 || i === 29 || i === 47;
    list.push({
      x, z,
      w: landmark ? 70 + rnd() * 25 : 46 + rnd() * 60,
      d: 46 + rnd() * 60,
      h: landmark ? 150 + rnd() * 60 : 55 + rnd() * 75,
      kind: landmark ? 'landmark' : (rnd() > 0.5 ? 'tower' : 'slab'),
      seed: rnd(),
    });
  }
  return list;
}

// Street lights for m4: two avenues flanking the corridor plus cross streets.
export function cityLights() {
  const lights = [];
  for (let z = 300; z <= 8000; z += 170) {
    lights.push({ x: -150, z });
    lights.push({ x: 150, z });
  }
  for (const z of [1200, 2900, 4600, 6300, 8000]) {
    for (let x = -720; x <= 720; x += 180) lights.push({ x, z });
  }
  return lights;
}

// Interpolate a colour ramp: stops are [height, [r, g, b]].
function ramp(stops, h) {
  if (h <= stops[0][0]) return stops[0][1].slice();
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i][0]) {
      const h0 = stops[i - 1][0], c0 = stops[i - 1][1];
      const h1 = stops[i][0], c1 = stops[i][1];
      const t = (h - h0) / (h1 - h0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return stops[stops.length - 1][1].slice();
}

function clamp255(v) {
  return Math.max(0, Math.min(255, v));
}

// Colour for one ground sample, by height and mission. Continuous ramps plus
// a fine detail noise, so no flat colour field and no hard contour steps.
export function groundColor(h, x, z, mission, dist) {
  let c;
  if (mission === 'm2') {
    c = ramp([[0, [196, 148, 84]], [40, [196, 148, 84]], [80, [214, 172, 104]], [120, [188, 138, 82]], [170, [150, 104, 66]]], h);
  } else if (mission === 'm3') {
    if (h <= 0) {
      // Smooth sea shimmer from continuous noise, never per-cell blocks.
      const shimmer = fbm(x * 0.02, z * 0.02, 55, 2) * 16;
      c = [10 + shimmer, 26 + shimmer, 62 + shimmer * 2];
    } else {
      c = ramp([[0, [214, 196, 150]], [30, [214, 196, 150]], [60, [74, 128, 74]], [110, [96, 104, 88]]], h);
    }
  } else if (mission === 'm4') {
    const block = (Math.floor(x / 120) + Math.floor(z / 120)) % 2 === 0;
    const vary = (hashNoise(Math.floor(x / 120), Math.floor(z / 120), 71) - 0.5) * 10;
    c = block ? [38 + vary, 40 + vary, 52 + vary] : [30 + vary, 32 + vary, 44 + vary];
  } else {
    c = ramp([[0, [86, 132, 80]], [45, [86, 132, 80]], [90, [62, 110, 66]], [140, [104, 96, 74]], [185, [122, 116, 108]], [230, [232, 236, 240]]], h);
  }
  // Micro relief: fine grain breaks any remaining flat field.
  const d = (fbm(x * 0.045, z * 0.045, 77, 2) - 0.5) * 22;
  return [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d)];
}

// Sky, fog and light for each mission. haze is the strength of the horizon
// haze band; rain turns on the rain streaks; sunGlow widens the sun halo.
export function missionPalette(mission) {
  if (mission === 'm2') return {
    skyTop: '#f7b733', skyMid: '#e88f4a', skyBot: '#c97e4e', sun: '#fff3c4',
    fog: [222, 158, 96], sunX: 0.72, sunY: 0.2, night: false,
    haze: 0.85, rain: false, sunGlow: 1.5,
  };
  if (mission === 'm3') return {
    skyTop: '#050914', skyMid: '#0d1b3d', skyBot: '#1b2f5e', sun: '#f4f1de',
    fog: [13, 22, 46], sunX: 0.24, sunY: 0.16, night: true,
    haze: 0.3, rain: false, sunGlow: 1.1,
  };
  if (mission === 'm4') return {
    skyTop: '#070a18', skyMid: '#131a33', skyBot: '#232a4d', sun: '#e8ecff',
    fog: [16, 20, 42], sunX: 0.8, sunY: 0.14, night: true,
    haze: 0.4, rain: false, sunGlow: 1.2,
  };
  return {
    skyTop: '#3f7fd0', skyMid: '#8fc3ee', skyBot: '#d9ecfa', sun: '#fff8d6',
    fog: [168, 198, 228], sunX: 0.68, sunY: 0.18, night: false,
    haze: 0.55, rain: true, sunGlow: 1.0,
  };
}

export function fogBlend(rgb, fog, t) {
  const k = Math.max(0, Math.min(1, t));
  return [rgb[0] + (fog[0] - rgb[0]) * k, rgb[1] + (fog[1] - rgb[1]) * k, rgb[2] + (fog[2] - rgb[2]) * k];
}
