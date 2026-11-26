// missions.js — the story of Operasi Garuda Senja and its four sorties.
// Andra "Elang" Prasetyo flies the air bridge for the island federation of
// Kepulauan Senja: medicine, mail and hope, one valley at a time.
// v3: every sortie ends in a landing. Thread the rings, then put the plane
// down soft and centred on the strip — the landing score is part of the
// mission, and a hard one bends the airframe.

import { buildRings, terrainHeight, finalStrip } from './world.js';

export const MISSIONS = [
  {
    id: 'm1',
    name: 'Misi 1 — Lembah Kabut',
    short: 'Lembah Kabut',
    briefing: 'Hujan menutup Lembah Senja. Antar vaksin ke Desa Awan — terbang menembus 6 cincin penanda di antara puncak, jangan sentuh tebing, lalu mendarat di landasan desa.',
    objective: 'Terbang menembus 6 cincin, lalu mendarat di landasan.',
    terrain: 'Pegunungan hijau berkabut, hujan',
    rings: 6,
  },
  {
    id: 'm2',
    name: 'Misi 2 — Ngarai Emas',
    short: 'Ngarai Emas',
    briefing: 'Badai pasir datang dari timur. Konvoi darat terjebak di Ngarai Emas — kirim peta evakuasi lewat udara, 8 cincin di antara dinding ngarai. Angin kencang, jaga ketinggian, dan akhiri dengan pendaratan di strip gurun.',
    objective: 'Terbang menembus 8 cincin di ngarai gurun saat golden hour, lalu mendarat.',
    terrain: 'Gurun dan ngarai keemasan, haze senja',
    rings: 8,
  },
  {
    id: 'm3',
    name: 'Misi 3 — Laut Bintang',
    short: 'Laut Bintang',
    briefing: 'Malam tanpa bulan di Laut Bintang. Mercusuar pulau-pulau kecil adalah satu-satunya penanda. Antar radio darurat ke Pulau Lentera — 7 cincin di atas ombak, lalu mendarat di landasan apung kapal induk.',
    objective: 'Terbang menembus 7 cincin antar pulau di malam hari, lalu mendarat di landasan apung.',
    terrain: 'Laut malam dan pulau bercahaya',
    rings: 7,
  },
  {
    id: 'm4',
    name: 'Misi 4 — Kota Neon',
    short: 'Kota Neon',
    briefing: 'Final. Kota Neon menyalakan lampunya untukmu. Terbang di antara menara, tembus 8 cincin, dan akhiri dengan pendaratan di landasan Kota Neon — pendaratan yang ditunggu seluruh kepulauan.',
    objective: 'Terbang menembus 8 cincin di antara menara, mendarat di landasan.',
    terrain: 'Kota malam dengan menara bercahaya',
    rings: 8,
  },
];

export function missionRings(missionId) {
  return buildRings(missionId);
}

// The strip a mission lands on: under its final ring.
export function landingTarget(missionId) {
  return finalStrip(missionId);
}

// Landing approach: glide down a 6% slope to the strip centre, gentle pitch,
// approach speed near 50 m/s, gear down. Inside the approach corridor the
// plane rides the glidepath; outside it — overshot, off to one side — it goes
// around: climb to a safe altitude and rejoin the extended centreline 700 m
// out. The pull-up that saves a pilot from a ridge is switched off here —
// the ground is the destination.
function landingInput(plane, missionId) {
  const strip = finalStrip(missionId);
  const dx = strip.cx - plane.x, dz = strip.cz - plane.z;
  const along = dx * strip.dir.x + dz * strip.dir.z; // >0: still before the strip
  const across = dx * (-strip.dir.z) + dz * strip.dir.x;
  const inCorridor = Math.abs(across) < 160 && along > -100 && along < 900;
  let tx, tz, wantY;
  if (inCorridor) {
    tx = strip.cx; tz = strip.cz;
    // The glidepath floor sits BELOW the touchdown trigger (ground + 4):
    // the plane tracking it must cross the trigger, never level above it.
    wantY = strip.h + Math.max(2, along * 0.055);
  } else {
    tx = strip.cx - strip.dir.x * 700;
    tz = strip.cz - strip.dir.z * 700;
    wantY = strip.h + 80;
  }
  // Never fly into a ridge on the way down: until the plane is truly over
  // the strip's near half, stay 20 m above the ground 150 m ahead. Only on
  // final does the glidepath rule alone, so the last descent is never blocked.
  const onFinal = Math.abs(across) < strip.w / 2 + 20 && along > -100 && along < 250;
  if (!onFinal) {
    const aheadX = plane.x + Math.sin(plane.heading) * 150;
    const aheadZ = plane.z + Math.cos(plane.heading) * 150;
    const groundAhead = terrainHeight(aheadX, aheadZ, missionId);
    wantY = Math.max(wantY, groundAhead + 20);
  }
  const tdx = tx - plane.x, tdz = tz - plane.z;
  const wantHeading = Math.atan2(tdx, tdz);
  let diff = wantHeading - plane.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const dy = wantY - plane.y;
  // Tight pitch band close in: the glidepath flattens to strip.h + 2 over the
  // strip, and a wide deadband would leave the plane levelling above the
  // touchdown trigger forever, flying past the strip instead of landing.
  const dyBand = along < 200 ? 0.5 : 6;
  return {
    left: diff > 0.05,
    right: diff < -0.05,
    pitchUp: dy > dyBand,
    pitchDown: dy < -dyBand,
    throttleUp: plane.speed < 48,
    throttleDown: plane.speed > 56,
    boost: false,
    gear: true,
    gentle: true,
  };
}

// Simple autopilot used by the attract/demo mode and by screenshot captures:
// banks toward the next ring and pitches toward its altitude, and pulls up
// when the ground ahead gets too close. After the final ring it flies the
// landing approach instead.
export function autopilotInput(plane, ring, missionId) {
  if (!ring) {
    if (plane.landing) return landingInput(plane, missionId);
    return {};
  }
  const dx = ring.x - plane.x, dz = ring.z - plane.z;
  const wantHeading = Math.atan2(dx, dz);
  let diff = wantHeading - plane.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const dy = ring.y - plane.y;
  const aheadX = plane.x + Math.sin(plane.heading) * 130;
  const aheadZ = plane.z + Math.cos(plane.heading) * 130;
  const groundAhead = terrainHeight(aheadX, aheadZ, missionId);
  const pullUp = plane.y - groundAhead < 48;
  return {
    left: diff > 0.06,
    right: diff < -0.06,
    pitchUp: dy > 12 || pullUp,
    pitchDown: dy < -12 && !pullUp,
    throttleUp: plane.speed < 62,
    throttleDown: plane.speed > 78,
    boost: false,
  };
}
