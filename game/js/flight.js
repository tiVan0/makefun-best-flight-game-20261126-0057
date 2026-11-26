// flight.js — the flight model and the chase-view aircraft drawing.
// Arcade handling with real discipline: throttle sets speed, banking turns the
// plane, pitch trades speed for altitude, and the ground always wins a mistake.

import { terrainHeight, waterLevel } from './world.js';

export function createPlane(mission) {
  return {
    x: 0, z: 0, y: 150,
    heading: 0,           // radians, 0 = flying toward +z
    speed: 42,            // m/s
    throttle: 0.62,       // 0..1
    pitch: 0,             // radians, positive = nose up
    roll: 0,              // radians, positive = banking right
    fuel: 100,            // percent
    boost: 100,           // boost energy percent
    ringsPassed: 0,
    score: 0,
    crashed: false,
    crashReason: '',
    finished: false,
    time: 0,
    verticalSpeed: 0,
  };
}

const MAX_SPEED = 96, MIN_SPEED = 26;

export function updateFlight(plane, input, dt, mission) {
  if (plane.crashed || plane.finished) return;
  plane.time += dt;

  // Throttle: Shift / W raises it, Control / S lowers it.
  if (input.throttleUp) plane.throttle = Math.min(1, plane.throttle + dt * 0.45);
  if (input.throttleDown) plane.throttle = Math.max(0, plane.throttle - dt * 0.55);

  // Boost: Space burns boost energy for extra speed.
  let targetSpeed = MIN_SPEED + plane.throttle * (MAX_SPEED - MIN_SPEED);
  if (input.boost && plane.boost > 0) {
    targetSpeed += 34;
    plane.boost = Math.max(0, plane.boost - dt * 26);
  } else {
    plane.boost = Math.min(100, plane.boost + dt * 7);
  }
  plane.speed += (targetSpeed - plane.speed) * Math.min(1, dt * 0.9);

  // Roll toward the commanded bank, then turn with the bank.
  const rollTarget = (input.right ? 1 : 0) * 0.55 + (input.left ? -1 : 0) * 0.55;
  plane.roll += (rollTarget - plane.roll) * Math.min(1, dt * 3.2);
  plane.heading += -plane.roll * dt * 0.55 * (0.5 + plane.speed / MAX_SPEED);

  // Pitch: Up / Down keys, eased; pitch trades speed for climb.
  const pitchTarget = (input.pitchUp ? 1 : 0) * 0.30 + (input.pitchDown ? -1 : 0) * 0.34;
  plane.pitch += (pitchTarget - plane.pitch) * Math.min(1, dt * 2.6);
  plane.verticalSpeed = Math.sin(plane.pitch) * plane.speed;
  plane.y += plane.verticalSpeed * dt;
  if (plane.y < 4) plane.y = 4;

  // Move along the heading.
  plane.x += Math.sin(plane.heading) * plane.speed * dt;
  plane.z += Math.cos(plane.heading) * plane.speed * dt;

  // Fuel: throttle burns it, rings refund some of it.
  plane.fuel -= dt * (0.55 + plane.throttle * 1.15);
  if (plane.fuel <= 0) {
    plane.fuel = 0;
    plane.throttle = Math.max(0, plane.throttle - dt * 0.4);
    if (plane.speed < 30) crashPlane(plane, 'Kehabisan bahan bakar');
  }

  // Terrain collision.
  const ground = terrainHeight(plane.x, plane.z, mission);
  if (plane.y <= ground + 3) crashPlane(plane, ground <= waterLevel(mission) ? 'Mendarat di laut' : 'Menabrak terrain');
}

export function crashPlane(plane, reason) {
  if (plane.crashed) return;
  plane.crashed = true;
  plane.crashReason = reason;
}

// True when the plane flies through a ring: close in 3D and crossing its plane.
export function checkRing(plane, ring) {
  const dx = plane.x - ring.x, dy = plane.y - ring.y, dz = plane.z - ring.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return dist < ring.r + 14;
}

export function passRing(plane, ring) {
  plane.ringsPassed += 1;
  plane.score += 500 + Math.round(plane.speed);
  plane.fuel = Math.min(100, plane.fuel + 9);
  if (ring.final) plane.finished = true;
}

// Draw the aircraft from directly behind, banking with the roll, at screen
// position (cx, cy) with size s. All vector art, no image assets.
export function drawAircraft(ctx, cx, cy, s, plane, t) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-plane.roll * 0.9);
  ctx.scale(1 + plane.speed / 900, 1);

  // Engine glow.
  const glow = ctx.createRadialGradient(0, s * 0.42, 2, 0, s * 0.42, s * 0.5);
  glow.addColorStop(0, 'rgba(255, 190, 90, 0.9)');
  glow.addColorStop(1, 'rgba(255, 120, 30, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, s * 0.42, s * 0.5, 0, Math.PI * 2); ctx.fill();

  // Wings.
  ctx.fillStyle = '#c8ccd4';
  ctx.strokeStyle = '#5c6470'; ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.beginPath();
  ctx.moveTo(-s * 1.05, s * 0.08); ctx.lineTo(-s * 0.16, -s * 0.02);
  ctx.lineTo(-s * 0.14, s * 0.16); ctx.lineTo(-s * 0.95, s * 0.3);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 1.05, s * 0.08); ctx.lineTo(s * 0.16, -s * 0.02);
  ctx.lineTo(s * 0.14, s * 0.16); ctx.lineTo(s * 0.95, s * 0.3);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // Fuselage (seen from behind: a tapered body with a glowing tail cone).
  const body = ctx.createLinearGradient(-s * 0.2, 0, s * 0.2, 0);
  body.addColorStop(0, '#8d99a8'); body.addColorStop(0.5, '#e8ecf2'); body.addColorStop(1, '#8d99a8');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.62);
  ctx.quadraticCurveTo(s * 0.2, -s * 0.1, s * 0.17, s * 0.34);
  ctx.quadraticCurveTo(0, s * 0.46, -s * 0.17, s * 0.34);
  ctx.quadraticCurveTo(-s * 0.2, -s * 0.1, 0, -s * 0.62);
  ctx.fill(); ctx.stroke();

  // Tail fin.
  ctx.fillStyle = '#d23c2e';
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.6); ctx.lineTo(-s * 0.07, -s * 0.86); ctx.lineTo(s * 0.07, -s * 0.86);
  ctx.closePath(); ctx.fill();

  // Canopy glint.
  ctx.fillStyle = 'rgba(140, 210, 255, 0.85)';
  ctx.beginPath(); ctx.ellipse(0, -s * 0.3, s * 0.07, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();

  // Navigation lights: red left, green right, blinking white tail strobe.
  const blink = (t % 1.2) < 0.12;
  ctx.fillStyle = '#ff2d2d';
  ctx.beginPath(); ctx.arc(-s * 1.02, s * 0.14, s * 0.045, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2dff5e';
  ctx.beginPath(); ctx.arc(s * 1.02, s * 0.14, s * 0.045, 0, Math.PI * 2); ctx.fill();
  if (blink) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(0, -s * 0.86, s * 0.05, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
