// missions.js — the story of Operasi Garuda Senja and its four sorties.
// Andra "Elang" Prasetyo flies the air bridge for the island federation of
// Kepulauan Senja: medicine, mail and hope, one valley at a time.

import { buildRings, terrainHeight } from './world.js';

export const MISSIONS = [
  {
    id: 'm1',
    name: 'Misi 1 — Lembah Kabut',
    short: 'Lembah Kabut',
    briefing: 'Kabut pagi menutup Lembah Senja. Antar vaksin ke Desa Awan — terbang menembus 6 cincin penanda di antara puncak, jangan sentuh tebing.',
    objective: 'Terbang menembus 6 cincin, lalu cincin akhir di atas landasan.',
    terrain: 'Pegunungan hijau berkabut',
    rings: 6,
  },
  {
    id: 'm2',
    name: 'Misi 2 — Ngarai Emas',
    short: 'Ngarai Emas',
    briefing: 'Badai pasir datang dari timur. Konvoi darat terjebak di Ngarai Emas — kirim peta evakuasi lewat udara, 8 cincin di antara dinding ngarai. Angin kencang, jaga ketinggian.',
    objective: 'Terbang menembus 8 cincin di ngarai gurun saat golden hour.',
    terrain: 'Gurun dan ngarai keemasan',
    rings: 8,
  },
  {
    id: 'm3',
    name: 'Misi 3 — Laut Bintang',
    short: 'Laut Bintang',
    briefing: 'Malam tanpa bulan di Laut Bintang. Mercusuar pulau-pulau kecil adalah satu-satunya penanda. Antar radio darurat ke Pulau Lentera — 7 cincin di atas ombak.',
    objective: 'Terbang menembus 7 cincin antar pulau di malam hari.',
    terrain: 'Laut malam dan pulau bercahaya',
    rings: 7,
  },
  {
    id: 'm4',
    name: 'Misi 4 — Kota Neon',
    short: 'Kota Neon',
    briefing: 'Final. Kota Neon menyalakan lampunya untukmu. Terbang di antara menara, tembus 8 cincin, dan akhiri di cincin akhir di atas landasan Kota Neon — pendaratan yang ditunggu seluruh kepulauan.',
    objective: 'Terbang menembus 8 cincin di antara menara, finis di atas landasan.',
    terrain: 'Kota malam dengan menara bercahaya',
    rings: 8,
  },
];

export function missionRings(missionId) {
  return buildRings(missionId);
}

// Simple autopilot used by the attract/demo mode and by screenshot captures:
// banks toward the next ring and pitches toward its altitude, and pulls up
// when the ground ahead gets too close.
export function autopilotInput(plane, ring, missionId) {
  if (!ring) return {};
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
