// main.js — bootstrap, game loop, input and the mission state machine.
// Opens on a briefing screen; keyboard flies the plane, mouse works the menus.
// ?shot=m1|m2|m3|m4 jumps straight into a mission with the autopilot flying,
// so a screenshot captures the game mid-flight with the HUD lit.
// ?shot=m4&land=1 warms the autopilot all the way to the landing approach
// and freezes the frame there: gear down, runway ahead, final ring overhead.
// v3: a mission is only complete when the plane is down on its strip.

import { createPlane, updateFlight, checkRing, passRing } from './flight.js';
import { renderScene } from './render.js';
import { MISSIONS, missionRings, autopilotInput, landingTarget } from './missions.js';
import { SoundEngine } from './audio.js';
import { buildHud, updateHud, showMessage } from './hud.js';
import { terrainHeight } from './world.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const sound = new SoundEngine();
const params = new URLSearchParams(location.search);
const shotMission = params.get('shot');
const autoMode = params.has('auto') || !!shotMission;

let missionIndex = 0;
let plane = null;
let rings = [];
let state = 'menu'; // menu | briefing | flying | landing | paused | crashed | done | complete
let input = {};
let lastTime = 0;
let warnedLowFuel = false;
let warnedTerrain = false;
let warnedStall = false;
let startDelay = 0;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

buildHud(document.getElementById('hud'));

function startMission(i) {
  missionIndex = i;
  const m = MISSIONS[i];
  plane = createPlane(m.id);
  // Start well above the valley floor, already moving, facing the first rings.
  plane.y = terrainHeight(0, 0, m.id) + 210;
  rings = missionRings(m.id);
  state = 'flying';
  warnedLowFuel = false; warnedTerrain = false; warnedStall = false;
  document.getElementById('overlay').classList.add('hidden');
  showMessage(m.name, m.objective);
  sound.ensure();
}

function showMenu() {
  state = 'menu';
  const ov = document.getElementById('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `
    <h1>OPERASI GARUDA SENJA</h1>
    <p class="tag">Jembatan udara Kepulauan Senja — empat misi, satu pesawat, langit milikmu.</p>
    <div class="missions">
      ${MISSIONS.map((m, i) => `
        <button class="mission-btn" data-i="${i}">
          <b>${m.name}</b><span>${m.terrain} — ${m.rings} cincin + pendaratan</span>
        </button>`).join('')}
    </div>
    <p class="keys">← → belok &nbsp;·&nbsp; ↑ ↓ pitch &nbsp;·&nbsp; Shift / Ctrl throttle &nbsp;·&nbsp; Spasi boost &nbsp;·&nbsp; G roda &nbsp;·&nbsp; R ulang &nbsp;·&nbsp; P jeda &nbsp;·&nbsp; M suara</p>
    <p class="foot">Game orisinal — ide, gambar, dan suara dibuat untuk bounty ini.</p>`;
  ov.querySelectorAll('.mission-btn').forEach((b) =>
    b.addEventListener('click', () => startMission(Number(b.dataset.i))));
}

function showEnd(title, lines, nextLabel, nextFn) {
  const ov = document.getElementById('overlay');
  ov.classList.remove('hidden');
  ov.innerHTML = `<h1>${title}</h1>${lines.map((l) => `<p class="tag">${l}</p>`).join('')}
    <button id="end-next" class="mission-btn"><b>${nextLabel}</b></button>
    <button id="end-menu" class="mission-btn"><b>Menu Utama</b></button>`;
  document.getElementById('end-next').addEventListener('click', nextFn);
  document.getElementById('end-menu').addEventListener('click', showMenu);
}

function endMission() {
  const m = MISSIONS[missionIndex];
  const time = Math.floor(plane.time);
  const fuelBonus = Math.max(0, Math.round(plane.fuel)) * 10;
  const landBonus = plane.landingScore || 0;
  plane.score += fuelBonus + landBonus;
  if (plane.landed) sound.land();
  sound.fanfare();
  const lines = [
    `${m.name} tuntas dalam ${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')} — skor ${plane.score} (bonus bahan bakar +${fuelBonus}, pendaratan +${landBonus}).`,
    `Skor pendaratan ${plane.landingScore}/100${plane.damage > 0 ? ` — kerusakan ${plane.damage}%` : ' — mulus, tanpa kerusakan'}.`,
    'Paket sudah sampai. Kepulauan Senja berterima kasih, Elang.',
  ];
  if (missionIndex + 1 < MISSIONS.length) {
    state = 'done';
    showEnd('MISI SELESAI ✓', lines, 'Misi Berikutnya →', () => startMission(missionIndex + 1));
  } else {
    state = 'complete';
    showEnd('OPERASI GARUDA SENJA — TUNTAS ★',
      [`Empat misi selesai. Skor akhir ${plane.score}.`, `Pendaratan terakhir ${plane.landingScore}/100.`, 'Seluruh Kepulauan Senja kini terhubung oleh jembatan udaramu. Terima kasih, Elang.'],
      'Terbang Lagi', () => startMission(0));
  }
}

function endCrash() {
  state = 'crashed';
  sound.crash();
  showEnd('PESAWAT JATUH',
    [`${plane.crashReason}.`, `Misi ${MISSIONS[missionIndex].name} — ${plane.ringsPassed}/${rings.length} cincin dilewati, skor ${plane.score}.`],
    'Coba Lagi (R)', () => startMission(missionIndex));
}

// Keyboard input.
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'pitchUp', KeyW: 'pitchUp',
  ArrowDown: 'pitchDown', KeyS: 'pitchDown',
  ShiftLeft: 'throttleUp', ShiftRight: 'throttleUp',
  ControlLeft: 'throttleDown', ControlRight: 'throttleDown',
  Space: 'boost',
};
window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (k) { input[k] = true; e.preventDefault(); }
  if (e.code === 'KeyR' && (state === 'crashed' || state === 'flying' || state === 'landing')) startMission(missionIndex);
  if (e.code === 'KeyG' && (state === 'flying' || state === 'landing') && plane) {
    plane.gear = !plane.gear;
    showMessage(plane.gear ? 'RODA TURUN' : 'RODA NAIK', plane.gear ? 'Siap mendarat' : '');
  }
  if (e.code === 'KeyP' && state === 'flying') { state = 'paused'; showMessage('JEDA', 'Tekan P untuk lanjut'); }
  else if (e.code === 'KeyP' && state === 'paused') { state = 'flying'; document.getElementById('hud-msg').classList.remove('show'); }
  if (e.code === 'KeyM') { sound.ensure(); showMessage(sound.toggleMute() ? 'Suara mati' : 'Suara hidup', ''); }
  if (e.code === 'Enter' && state === 'menu') startMission(0);
  sound.ensure();
});
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (k) input[k] = false;
});
canvas.addEventListener('mousedown', () => sound.ensure());

function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastTime) / 1000 || 0.016);
  lastTime = t;
  const now = t;

  if ((state === 'flying' || state === 'landing') && plane) {
    const nextRing = rings[plane.ringsPassed];
    const effInput = autoMode ? autopilotInput(plane, nextRing, MISSIONS[missionIndex].id) : input;
    if (autoMode) startDelay += dt;
    updateFlight(plane, effInput, dt, MISSIONS[missionIndex].id);
    sound.setFlight(plane.throttle, plane.speed);

    if (nextRing && checkRing(plane, nextRing)) {
      passRing(plane, nextRing);
      sound.ringChime();
      if (plane.landing) {
        state = 'landing';
        showMessage('CINCIN AKHIR!', 'Turun ke landasan — sentuh pelan di tengah');
      } else {
        showMessage(`CINCIN ${plane.ringsPassed}/${rings.length}`, '+12 bahan bakar');
      }
    }
    if (plane.fuel < 25 && !warnedLowFuel) { warnedLowFuel = true; sound.warning(); showMessage('⚠ BAHAN BAKAR MENIPIS', 'Cincin berikutnya mengisi +12'); }
    if (plane.y < 45 && !warnedTerrain) { warnedTerrain = true; sound.warning(); }
    if (plane.y > 60) warnedTerrain = false;
    if (plane.stall && !warnedStall) { warnedStall = true; sound.warning(); }
    if (!plane.stall) warnedStall = false;
    if (plane.crashed) endCrash();
    else if (plane.finished) endMission();
  }

  // Camera sits behind and slightly above the plane, looking along its heading.
  const m = MISSIONS[missionIndex];
  const cam = plane
    ? { x: plane.x - Math.sin(plane.heading) * 26, y: plane.y + 9, z: plane.z - Math.cos(plane.heading) * 26, heading: plane.heading, pitch: plane.pitch * 0.55 }
    : { x: 0, y: 260, z: -600, heading: 0, pitch: 0 };
  if (state === 'menu') {
    cam.z = -600 + now * 0.02; cam.y = 300; cam.heading = 0.1;
  }
  renderScene(ctx, canvas.width, canvas.height, cam, plane || createPlane(m.id), m.id, rings, now / 1000);
  if (plane && (state === 'flying' || state === 'landing' || state === 'paused' || state === 'crashed' || state === 'done' || state === 'complete')) {
    updateHud(plane, m, rings, now);
  }
}

// Fast-forward the real flight model by N fixed steps (used by screenshot
// captures): the autopilot flies the plane through the same update path the
// live game uses, so a still image shows the game genuinely mid-flight.
function warmUp(steps) {
  const dt = 1 / 60;
  for (let i = 0; i < steps; i++) {
    if (plane.crashed || plane.finished) break;
    const nextRing = rings[plane.ringsPassed];
    updateFlight(plane, autopilotInput(plane, nextRing, MISSIONS[missionIndex].id), dt, MISSIONS[missionIndex].id);
    if (nextRing && checkRing(plane, nextRing)) passRing(plane, nextRing);
  }
}

// Fast-forward onto the landing approach: keep flying until the plane is on
// final, gear down, with the strip and its ring ahead — then freeze the frame.
function warmUpLanding() {
  const dt = 1 / 60;
  const strip = landingTarget(MISSIONS[missionIndex].id);
  let steps = 0;
  while (steps < 9000 && !plane.crashed && !plane.finished) {
    const nextRing = rings[plane.ringsPassed];
    updateFlight(plane, autopilotInput(plane, nextRing, MISSIONS[missionIndex].id), dt, MISSIONS[missionIndex].id);
    if (nextRing && checkRing(plane, nextRing)) passRing(plane, nextRing);
    steps++;
    if (plane.landing) {
      const dist = Math.hypot(plane.x - strip.cx, plane.z - strip.cz);
      if (dist < 650 && plane.y < strip.h + 75) break;
    }
  }
  // Freeze the approach frame for the screenshot.
  state = 'paused';
}

// Screenshot / demo entry: jump straight into a mission, autopilot flying.
if (shotMission) {
  const idx = MISSIONS.findIndex((mm) => mm.id === shotMission);
  startMission(idx >= 0 ? idx : 0);
  const warm = Number(params.get('warm') || 0);
  if (warm > 0) warmUp(Math.min(warm, 2400));
  if (params.get('land') === '1') warmUpLanding();
  // Screenshots want a clean frame: drop the mission title card now that
  // the warm-up has flown the plane into the action.
  clearTimeout(showMessage._t);
  document.getElementById('hud-msg').classList.remove('show');
} else {
  showMenu();
}
requestAnimationFrame(loop);
