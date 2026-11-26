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
// Denser than v3, and each lamp is warm amber or cool white, so the city
// floor reads as a living grid instead of a single-colour dot field.
export function cityLights() {
  const lights = [];
  for (let z = 300; z <= 8000; z += 120) {
    lights.push({ x: -150, z, c: hashNoise(1, z, 73) > 0.35 ? 0 : 1 });
    lights.push({ x: 150, z, c: hashNoise(2, z, 73) > 0.35 ? 0 : 1 });
  }
  for (const z of [1200, 2100, 2900, 3800, 4600, 5500, 6300, 7200, 8000]) {
    for (let x = -720; x <= 720; x += 120) {
      lights.push({ x, z, c: hashNoise(x, z, 74) > 0.35 ? 0 : 1 });
    }
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

// Colour for one ground sample, by height and mission. Patch-based colour
// (large soft fbm patches) instead of height-only ramps, so the ground reads
// as vegetation, sand and rock — never as flat colour fields or contour
// bands. A fine two-scale grain keeps the texture alive at close range.
export function groundColor(h, x, z, mission, dist) {
  // Large soft patch field (~150 m): 0 = dry/open, 1 = dense/vegetated.
  const patch = fbm(x * 0.006, z * 0.006, 91, 3);
  let c;
  if (mission === 'm2') {
    // Desert: light sand, deeper orange in the hollows, pale crests.
    const sand = [214, 172, 104], deep = [188, 138, 82], crest = [226, 190, 128];
    const t = patch;
    c = [
      sand[0] + (deep[0] - sand[0]) * (1 - t) * 0.8 + (crest[0] - sand[0]) * Math.max(0, h - 90) / 80,
      sand[1] + (deep[1] - sand[1]) * (1 - t) * 0.8 + (crest[1] - sand[1]) * Math.max(0, h - 90) / 80,
      sand[2] + (deep[2] - sand[2]) * (1 - t) * 0.8 + (crest[2] - sand[2]) * Math.max(0, h - 90) / 80,
    ];
  } else if (mission === 'm3') {
    if (h <= 0) {
      // Smooth sea shimmer from continuous noise, never per-cell blocks.
      const shimmer = fbm(x * 0.02, z * 0.02, 55, 2) * 16;
      c = [10 + shimmer, 26 + shimmer, 62 + shimmer * 2];
    } else if (h < 6) {
      // Beach ring: pale sand at the waterline, softening into vegetation.
      const t = h / 6;
      c = [214 - 60 * t, 196 - 40 * t, 150 - 30 * t];
    } else {
      // Island: vegetation patches, dry grass between them, rock on peaks.
      const veg = [74, 128, 74], dry = [158, 148, 104], rock = [96, 104, 88];
      const vegT = Math.max(0, Math.min(1, (patch - 0.42) * 3));
      c = [
        dry[0] + (veg[0] - dry[0]) * vegT,
        dry[1] + (veg[1] - dry[1]) * vegT,
        dry[2] + (veg[2] - dry[2]) * vegT,
      ];
      const rockT = Math.max(0, Math.min(1, (h - 55) / 45));
      c = [c[0] + (rock[0] - c[0]) * rockT, c[1] + (rock[1] - c[1]) * rockT, c[2] + (rock[2] - c[2]) * rockT];
    }
  } else if (mission === 'm4') {
    const block = (Math.floor(x / 120) + Math.floor(z / 120)) % 2 === 0;
    const vary = (hashNoise(Math.floor(x / 120), Math.floor(z / 120), 71) - 0.5) * 10;
    c = block ? [38 + vary, 40 + vary, 52 + vary] : [30 + vary, 32 + vary, 44 + vary];
    // Lit avenues: warm pools of light along the two main roads and the
    // cross streets, so the city floor glows instead of staying flat dark.
    const ave = Math.min(Math.abs(Math.abs(x) - 150), 40);
    const cross = [1200, 2900, 4600, 6300, 8000].reduce((m, cz) => Math.min(m, Math.abs(z - cz)), 9999);
    const lit = Math.max(0, 1 - ave / 40) * 0.7 + Math.max(0, 1 - cross / 40) * 0.5;
    c = [c[0] + 26 * lit, c[1] + 18 * lit, c[2] + 6 * lit];
  } else {
    // Valley: meadow, forest patches and rock, snow softening in above
    // ~190 m — colour comes from patches as much as from height, so the
    // hills never read as stacked contour bands.
    const meadow = [86, 132, 80], forest = [52, 96, 58], rock = [122, 116, 108], snow = [232, 236, 240];
    const forestT = Math.max(0, Math.min(1, (patch - 0.45) * 2.5));
    c = [
      meadow[0] + (forest[0] - meadow[0]) * forestT,
      meadow[1] + (forest[1] - meadow[1]) * forestT,
      meadow[2] + (forest[2] - meadow[2]) * forestT,
    ];
    const rockT = Math.max(0, Math.min(1, (h - 130) / 60));
    c = [c[0] + (rock[0] - c[0]) * rockT, c[1] + (rock[1] - c[1]) * rockT, c[2] + (rock[2] - c[2]) * rockT];
    const snowT = Math.max(0, Math.min(1, (h - 185) / 45));
    c = [c[0] + (snow[0] - c[0]) * snowT, c[1] + (snow[1] - c[1]) * snowT, c[2] + (snow[2] - c[2]) * snowT];
  }
  // Micro relief: fine grain breaks any remaining flat field.
  const d = (fbm(x * 0.045, z * 0.045, 77, 2) - 0.5) * 14
    + (fbm(x * 0.13, z * 0.13, 79, 1) - 0.5) * 8;
  return [clamp255(c[0] + d), clamp255(c[1] + d), clamp255(c[2] + d)];
}

// Sky, fog and light for each mission. haze is the strength of the horizon
// haze band; rain turns on the rain streaks; sunGlow widens the sun halo.
export function missionPalette(mission) {
  if (mission === 'm2') return {
    skyTop: '#df7f2c', skyMid: '#f0a04e', skyBot: '#f2c98a', sun: '#fff0b8',
    fog: [226, 164, 102], sunX: 0.72, sunY: 0.2, night: false,
    haze: 0.9, rain: false, sunGlow: 1.9,
  };
  if (mission === 'm3') return {
    skyTop: '#04081a', skyMid: '#0c1838', skyBot: '#1d3263', sun: '#f4f1de',
    fog: [13, 22, 46], sunX: 0.24, sunY: 0.16, night: true,
    haze: 0.3, rain: false, sunGlow: 1.3,
  };
  if (mission === 'm4') return {
    skyTop: '#05071a', skyMid: '#121a38', skyBot: '#2b3560', sun: '#e8ecff',
    fog: [16, 20, 42], sunX: 0.8, sunY: 0.14, night: true,
    haze: 0.5, rain: false, sunGlow: 1.3,
  };
  return {
    skyTop: '#2e6bc2', skyMid: '#7fb8ec', skyBot: '#cfe8f8', sun: '#fff8d6',
    fog: [168, 198, 228], sunX: 0.68, sunY: 0.18, night: false,
    haze: 0.6, rain: true, sunGlow: 1.2,
  };
}

export function fogBlend(rgb, fog, t) {
  const k = Math.max(0, Math.min(1, t));
  return [rgb[0] + (fog[0] - rgb[0]) * k, rgb[1] + (fog[1] - rgb[1]) * k, rgb[2] + (fog[2] - rgb[2]) * k];
}
