// flight.js — the flight model and the chase-view aircraft drawing.
// Arcade handling with real discipline: throttle sets speed, banking turns the
// plane, pitch trades speed for altitude, and the ground always wins a mistake.
// v3: every mission ends in a landing. After the final ring the pilot flies a
// glidepath onto the strip: touch down soft and centred for a landing score,
// too hard or off the strip and the sortie ends in damage or a crash. A slow
// nose-high plane stalls and warns before it falls out of the sky.

import { terrainHeight, waterLevel, missionStrips, stripGround, deckAt } from './world.js';

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
    gear: false,          // landing gear down
    damage: 0,            // percent, from hard landings
    landing: false,       // final ring passed, flying the approach
    landed: false,        // touched down on the strip
    landingScore: null,   // 0..100, set at touchdown
    stall: false,         // slow and nose-high
  };
}

const MAX_SPEED = 96, MIN_SPEED = 26;

// The landing strip: the one under the final ring.
export function finalStrip(mission) {
  const strips = missionStrips(mission);
  return strips[strips.length - 1];
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function updateFlight(plane, input, dt, mission) {
  if (plane.crashed || plane.finished) return;
  plane.time += dt;

  // Gear: the pilot toggles it, the autopilot drops it on final.
  if (input.gear !== undefined) plane.gear = input.gear;

  // Throttle: Shift / W raises it, Control / S lowers it. An empty tank
  // takes no more throttle — otherwise the throttle would creep up on fumes.
  if (input.throttleUp && plane.fuel > 0) plane.throttle = Math.min(1, plane.throttle + dt * 0.45);
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

  // Pitch: Up / Down keys, eased; pitch trades speed for climb. On a gentle
  // landing approach the pitch authority is halved so the flare stays soft.
  const pitchScale = input.gentle ? 0.4 : 1;
  const pitchTarget = (input.pitchUp ? 1 : 0) * 0.30 * pitchScale + (input.pitchDown ? -1 : 0) * 0.34 * pitchScale;
  plane.pitch += (pitchTarget - plane.pitch) * Math.min(1, dt * 2.6);
  plane.verticalSpeed = Math.sin(plane.pitch) * plane.speed;
  plane.y += plane.verticalSpeed * dt;
  if (plane.y < 4) plane.y = 4;

  // Move along the heading.
  plane.x += Math.sin(plane.heading) * plane.speed * dt;
  plane.z += Math.cos(plane.heading) * plane.speed * dt;

  // Stall: slow and nose-high. A warning only — the pilot can still recover.
  plane.stall = plane.speed < 33 && plane.pitch > 0.12;

  // Fuel: throttle burns it, rings refund some of it.
  plane.fuel -= dt * (0.55 + plane.throttle * 1.15);
  if (plane.fuel <= 0) {
    plane.fuel = 0;
    plane.throttle = Math.max(0, plane.throttle - dt * 0.4);
    if (plane.speed < 30) crashPlane(plane, 'Kehabisan bahan bakar');
  }

  // Ground contact. On final the touchdown window (+4.0) is wider than the
  // terrain crash window (+3), so every ground contact while landing is
  // judged as a landing, never as a terrain crash.
  // Ground contact: stripGround, so an m3 carrier deck is solid ground at
  // deck height instead of the sea floor metres below the waterline.
  const ground = stripGround(plane.x, plane.z, mission);
  if (plane.landing && plane.y <= ground + 4.0) {
    const strip = finalStrip(mission);
    const dx = plane.x - strip.cx, dz = plane.z - strip.cz;
    const along = dx * strip.dir.x + dz * strip.dir.z;
    const across = dx * (-strip.dir.z) + dz * strip.dir.x;
    const stripHeading = Math.atan2(strip.dir.x, strip.dir.z);
    const headingDiff = Math.abs(angDiff(plane.heading, stripHeading));
    const onStrip = Math.abs(along) <= strip.len / 2 + 20 && Math.abs(across) <= strip.w / 2 + 18;
    if (onStrip) {
      // Touchdown on the strip: sink rate and centreline decide the score.
      const vs = Math.abs(plane.verticalSpeed);
      const offset = Math.abs(across);
      if (vs <= 4.5 && headingDiff < 0.4) {
        plane.landingScore = Math.max(20, Math.round(100 - vs * 9 - offset * 0.9 - headingDiff * 30));
        plane.damage = Math.max(0, Math.round((vs - 3) * 6 + offset * 0.2));
        plane.finished = true;
        plane.landed = true;
        return;
      }
      if (vs > 7 || headingDiff >= 0.4) {
        crashPlane(plane, vs > 7 ? 'Pendaratan terlalu keras' : 'Mendarat miring dari landasan');
        return;
      }
      // Firm but survivable: it counts, with damage.
      plane.landingScore = Math.max(10, Math.round(70 - vs * 6 - offset * 0.9));
      plane.damage = Math.round((vs - 4.5) * 12 + offset * 0.3);
      plane.finished = true;
      plane.landed = true;
      return;
    }
    // Down on the grass beside the strip: that is a crash, not a landing.
    crashPlane(plane, 'Mendarat di luar landasan');
    return;
  }

  // Terrain collision.
  if (plane.y <= ground + 3) {
    const reason = deckAt(plane.x, plane.z, mission)
      ? 'Menabrak landasan apung'
      : (ground <= waterLevel(mission) ? 'Mendarat di laut' : 'Menabrak terrain');
    crashPlane(plane, reason);
  }
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
  plane.fuel = Math.min(100, plane.fuel + 12);
  if (ring.final) {
    // The final ring arms the landing: gear down, fly the approach.
    // The mission only finishes on touchdown.
    plane.landing = true;
    plane.gear = true;
  }
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

  // Landing gear, dropped on final approach.
  if (plane.gear) {
    ctx.fillStyle = '#3a4152';
    ctx.fillRect(-s * 0.10, s * 0.30, s * 0.03, s * 0.14);
    ctx.fillRect(s * 0.07, s * 0.30, s * 0.03, s * 0.14);
    ctx.fillStyle = '#11141c';
    ctx.beginPath(); ctx.arc(-s * 0.085, s * 0.46, s * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.085, s * 0.46, s * 0.045, 0, Math.PI * 2); ctx.fill();
  }

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
