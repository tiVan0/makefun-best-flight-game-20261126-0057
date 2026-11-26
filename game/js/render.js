// render.js — the chase-view renderer: sky, voxel terrain flyover, runways,
// rings, city towers and the runway, all drawn on one 2D canvas, no assets.
// v3: real relief shading from the ray-march slope, layered volumetric clouds,
// a runway on every airfield, rain in the valley, horizon haze, richer city.

import { terrainHeight, groundColor, missionPalette, fogBlend, cityBuildings, cityLights, missionStrips, hashNoise } from './world.js';
import { drawAircraft } from './flight.js';

const COLS = 420;          // voxel columns across the screen
const STEPS = 130;         // samples along each ray
const FOV = 1.15;          // horizontal field of view, radians
const FAR = 1400;

// Project a world point into screen space. Returns {x, y, scale, behind}.
function project(px, py, pz, cam, W, H, horizon) {
  const dx = px - cam.x, dz = pz - cam.z;
  const fwd = dx * Math.sin(cam.heading) + dz * Math.cos(cam.heading);
  const lat = dx * Math.cos(cam.heading) - dz * Math.sin(cam.heading);
  if (fwd < 8) return { behind: true };
  const focal = (H * 1.05);
  return {
    x: W / 2 + (lat / fwd) * focal,
    y: horizon - ((py - cam.y) / fwd) * focal,
    scale: focal / fwd,
    behind: false,
  };
}

function clamp255(v) {
  return Math.max(0, Math.min(255, v));
}

// One cloud as a cluster of shaded puffs: bright crown, soft dark base.
function drawCloud(ctx, cx, cy, s, alpha, night) {
  const puffs = [[-0.42, 0.10, 0.40], [-0.12, -0.14, 0.52], [0.18, -0.06, 0.56], [0.48, 0.10, 0.42], [0.02, 0.14, 0.50]];
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const [ox, oy, r] of puffs) {
    const px = cx + ox * s, py = cy + oy * s, pr = r * s;
    const g = ctx.createRadialGradient(px, py, pr * 0.08, px, py, pr);
    if (night) {
      g.addColorStop(0, 'rgba(158,176,216,0.9)');
      g.addColorStop(0.7, 'rgba(110,126,172,0.55)');
      g.addColorStop(1, 'rgba(90,104,150,0)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,0.97)');
      g.addColorStop(0.65, 'rgba(240,244,252,0.8)');
      g.addColorStop(1, 'rgba(214,224,242,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawSky(ctx, W, H, pal, t, cam, mission) {
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  g.addColorStop(0, pal.skyTop); g.addColorStop(0.55, pal.skyMid); g.addColorStop(1, pal.skyBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.62);

  const horizon = H * 0.46 - cam.pitch * H * 0.35;

  // Horizon glow: warm light pooling where the sky meets the ground.
  const hg = ctx.createLinearGradient(0, horizon - H * 0.14, 0, horizon + H * 0.06);
  hg.addColorStop(0, 'rgba(0,0,0,0)');
  hg.addColorStop(0.6, pal.night ? 'rgba(140,160,220,0.20)' : 'rgba(255,226,150,0.34)');
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hg; ctx.fillRect(0, horizon - H * 0.14, W, H * 0.20);

  // Sun or moon, with a halo scaled by the mission's light.
  const sx = W * pal.sunX, sy = H * pal.sunY;
  const halo = H * 0.22 * pal.sunGlow;
  const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, halo);
  glow.addColorStop(0, pal.sun); glow.addColorStop(0.35, pal.night ? 'rgba(220,228,255,0.35)' : 'rgba(255,240,190,0.5)');
  glow.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = glow; ctx.fillRect(sx - halo, sy - halo, halo * 2, halo * 2);
  ctx.fillStyle = pal.sun;
  ctx.beginPath(); ctx.arc(sx, sy, pal.night ? H * 0.028 : H * 0.04, 0, Math.PI * 2); ctx.fill();

  // Stars at night, layered clouds by day and night.
  if (pal.night) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 90; i++) {
      const x = hashNoise(i, 3, 91) * W, y = hashNoise(i, 7, 92) * H * 0.4;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.7 + i));
      ctx.globalAlpha = tw * 0.9;
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
  }
  // Big layered puffs up high, small distant ones low.
  for (let i = 0; i < 5; i++) {
    const cx = ((hashNoise(i, 11, 93) * W + t * (6 + i * 2)) % (W + 320)) - 160;
    const cy = H * (0.06 + hashNoise(i, 13, 94) * 0.16);
    const cw = 110 + hashNoise(i, 17, 95) * 150;
    drawCloud(ctx, cx, cy, cw, pal.night ? 0.5 : 0.85, pal.night);
  }
  for (let i = 0; i < 6; i++) {
    const cx = ((hashNoise(i, 31, 96) * W + t * (4 + i)) % (W + 240)) - 120;
    const cy = H * (0.24 + hashNoise(i, 37, 97) * 0.10);
    const cw = 50 + hashNoise(i, 41, 98) * 70;
    drawCloud(ctx, cx, cy, cw, pal.night ? 0.35 : 0.5, pal.night);
  }

  // Distant ridge silhouettes, parallaxed by heading, so the horizon reads
  // as mountains even where the voxel terrain runs low.
  for (let layer = 0; layer < 2; layer++) {
    const amp = layer === 0 ? H * 0.075 : H * 0.045;
    const base = horizon - layer * H * 0.012;
    const shift = cam.heading * (layer === 0 ? 260 : 520);
    ctx.fillStyle = layer === 0
      ? (pal.night ? 'rgba(16,22,44,0.9)' : 'rgba(70,104,150,0.55)')
      : (pal.night ? 'rgba(22,30,58,0.9)' : 'rgba(96,128,168,0.5)');
    ctx.beginPath();
    ctx.moveTo(0, horizon + 2);
    for (let x = 0; x <= W; x += 8) {
      const n = hashNoise(Math.floor((x + shift) / 90) + layer * 40, 1, 97);
      const n2 = hashNoise(Math.floor((x + shift) / 34) + layer * 7, 2, 98);
      ctx.lineTo(x, base - (n * 0.7 + n2 * 0.3) * amp);
    }
    ctx.lineTo(W, horizon + 2);
    ctx.closePath(); ctx.fill();
  }
}

function drawTerrain(ctx, W, H, horizon, cam, mission, pal) {
  const proj = H * 1.05;
  const top = new Float32Array(COLS).fill(H + 2);
  for (let c = 0; c < COLS; c++) {
    const rayA = cam.heading + (c / COLS - 0.5) * FOV;
    const dx = Math.sin(rayA), dz = Math.cos(rayA);
    // Warm light from the sun side of the frame.
    const sunSide = 1 - Math.abs(c / COLS - pal.sunX);
    let d = 7;
    let prevH = null;
    for (let s = 0; s < STEPS; s++) {
      d *= 1.05;
      if (d > FAR) break;
      const px = cam.x + dx * d, pz = cam.z + dz * d;
      const h = terrainHeight(px, pz, mission);
      // Ground below the camera appears below the horizon; ground above it
      // (a mountain taller than the plane) pokes above the horizon line.
      const y = horizon + ((cam.y - h) / d) * proj;
      if (y < top[c] && y < H + 2) {
        const fogT = Math.min(1, d / (FAR * 0.75));
        const base = groundColor(h, px, pz, mission, d);
        // Relief shading: ground rising toward the camera catches the sun,
        // ground falling away sinks into shade. No extra heightfield reads —
        // the slope comes from consecutive samples along this same ray.
        let shade = 1;
        if (prevH !== null) {
          const step = d * 0.0476;
          const slope = (h - prevH) / step;
          shade = 1 + Math.max(-0.22, Math.min(0.30, slope * 0.08));
        }
        let col = fogBlend(base, pal.fog, fogT);
        col = [
          clamp255(col[0] * shade + 7 * sunSide),
          clamp255(col[1] * shade + 2 * sunSide),
          clamp255(col[2] * shade - 4 * sunSide),
        ];
        ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
        const x0 = (c / COLS) * W;
        ctx.fillRect(x0, y, W / COLS + 1, top[c] - y);
        top[c] = y;
      }
      prevH = h;
      if (top[c] <= horizon - H * 0.02 && d > 300) break;
    }
  }
}

function drawRing(ctx, ring, cam, W, H, horizon, t, passed) {
  const p = project(ring.x, ring.y, ring.z, cam, W, H, horizon);
  if (p.behind) return;
  const r = Math.max(2, ring.r * p.scale);
  if (r < 2 || p.x < -r * 2 || p.x > W + r * 2 || p.y < -r * 2 || p.y > H + r * 2) return;
  ctx.save();
  ctx.globalAlpha = passed ? 0.25 : 0.95;
  ctx.strokeStyle = ring.final ? '#ffd23c' : '#37e0ff';
  ctx.lineWidth = Math.max(2, r * 0.09);
  ctx.shadowColor = ring.final ? '#ffd23c' : '#37e0ff';
  ctx.shadowBlur = Math.min(26, r * 0.5);
  ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.92, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = ring.final ? '#ffd23c' : '#bff6ff';
  ctx.font = `bold ${Math.max(11, r * 0.34)}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(ring.final ? '★' : '◯', p.x, p.y - r * 1.25);
  ctx.restore();
}

function drawStreetlights(ctx, lights, cam, W, H, horizon, t) {
  for (const L of lights) {
    const dx = L.x - cam.x, dz = L.z - cam.z;
    const fwd = dx * Math.sin(cam.heading) + dz * Math.cos(cam.heading);
    if (fwd < 20 || fwd > 1300) continue;
    const p = project(L.x, 1, L.z, cam, W, H, horizon);
    if (p.behind) continue;
    const a = Math.max(0.15, 1 - fwd / 1300);
    const r = Math.max(1, Math.min(3, 900 / fwd));
    ctx.fillStyle = `rgba(255, 200, 110, ${(0.75 * a).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBuildings(ctx, buildings, cam, W, H, horizon, t) {
  const items = [];
  for (const b of buildings) {
    const dx = b.x - cam.x, dz = b.z - cam.z;
    const fwd = dx * Math.sin(cam.heading) + dz * Math.cos(cam.heading);
    if (fwd < 20 || fwd > 1300) continue;
    items.push({ b, fwd });
  }
  items.sort((a, b) => b.fwd - a.fwd);
  for (const { b } of items) {
    const base = project(b.x, 0, b.z, cam, W, H, horizon);
    const topP = project(b.x, b.h, b.z, cam, W, H, horizon);
    if (base.behind || topP.behind) continue;
    const w = Math.max(2, b.w * base.scale);
    const hgt = base.y - topP.y;
    if (hgt < 2) continue;
    // Sunlit side face, so a tower reads as a solid instead of a flat card.
    const sideW = Math.max(1, w * 0.14);
    ctx.fillStyle = '#1b2138';
    ctx.fillRect(base.x + w / 2, topP.y + hgt * 0.04, sideW, hgt * 0.96);
    // Front face.
    ctx.fillStyle = b.kind === 'landmark' ? '#0a0d1e' : '#0c0e1c';
    ctx.fillRect(base.x - w / 2, topP.y, w, hgt);
    // Windows: warm yellow, some cool cyan, density varies by building.
    const rows = Math.max(1, Math.floor(hgt / 14)), colsN = Math.max(1, Math.floor(w / 12));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < colsN; j++) {
        const n = hashNoise(i * 7 + j, b.x + b.seed * 100, 61);
        if (n > 0.55) {
          ctx.fillStyle = n > 0.9 ? 'rgba(120, 230, 255, 0.9)' : 'rgba(255, 214, 120, 0.85)';
          ctx.fillRect(base.x - w / 2 + 4 + j * 12, topP.y + 5 + i * 14, 4, 5);
        }
      }
    }
    // Rooftop edge light.
    ctx.fillStyle = 'rgba(55, 224, 255, 0.7)';
    ctx.fillRect(base.x - w / 2, topP.y, w, Math.max(1, hgt * 0.02));
    if (b.kind === 'landmark') {
      // Spire and a bright beacon on top.
      ctx.fillStyle = '#0a0d1e';
      ctx.beginPath();
      ctx.moveTo(base.x - w * 0.08, topP.y);
      ctx.lineTo(base.x, topP.y - hgt * 0.22);
      ctx.lineTo(base.x + w * 0.08, topP.y);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255, 80, 80, 0.95)';
      if ((t % 1.4) < 0.7) ctx.fillRect(base.x - 2, topP.y - hgt * 0.22 - 3, 4, 3);
    } else {
      ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';
      if ((t % 1.4) < 0.7) ctx.fillRect(base.x - 2, topP.y - 3, 4, 3);
    }
  }
}

function drawRunway(ctx, cam, W, H, horizon, mission) {
  const strips = missionStrips(mission);
  // Far to near so a nearer strip overlaps correctly.
  const sorted = strips.slice().sort((a, b) => {
    const da = Math.hypot(a.cx - cam.x, a.cz - cam.z);
    const db = Math.hypot(b.cx - cam.x, b.cz - cam.z);
    return db - da;
  });
  for (const s of sorted) {
    const px = -s.dir.z, pz = s.dir.x; // perpendicular to the strip
    const hw = s.w / 2, hl = s.len / 2;
    const corners = [
      [s.cx - px * hw - s.dir.x * hl, s.cz - pz * hw - s.dir.z * hl],
      [s.cx + px * hw - s.dir.x * hl, s.cz + pz * hw - s.dir.z * hl],
      [s.cx + px * hw + s.dir.x * hl, s.cz + pz * hw + s.dir.z * hl],
      [s.cx - px * hw + s.dir.x * hl, s.cz - pz * hw + s.dir.z * hl],
    ];
    const pts = corners.map(([x, z]) => project(x, s.h + 0.4, z, cam, W, H, horizon));
    if (pts.some((p) => p.behind)) continue;
    if (s.deck) {
      // Hull: a steel box from the deck down below the waterline, so the
      // floating runway reads as a carrier deck, not a hovering slab.
      ctx.fillStyle = '#1d222c';
      const edgeQuads = [
        [corners[0], corners[1]], [corners[1], corners[2]],
        [corners[2], corners[3]], [corners[3], corners[0]],
      ];
      for (const [[ax, az], [bx, bz]] of edgeQuads) {
        const p1 = project(ax, s.h + 0.4, az, cam, W, H, horizon);
        const p2 = project(bx, s.h + 0.4, bz, cam, W, H, horizon);
        const p3 = project(bx, -2, bz, cam, W, H, horizon);
        const p4 = project(ax, -2, az, cam, W, H, horizon);
        if (p1.behind || p2.behind || p3.behind || p4.behind) continue;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y);
        ctx.closePath(); ctx.fill();
      }
    }
    // Asphalt.
    ctx.fillStyle = '#23262e';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y); ctx.lineTo(pts[3].x, pts[3].y);
    ctx.closePath(); ctx.fill();
    // Edge lines.
    ctx.strokeStyle = 'rgba(245, 240, 200, 0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[3].x, pts[3].y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pts[1].x, pts[1].y); ctx.lineTo(pts[2].x, pts[2].y); ctx.stroke();
    // Dashed centreline.
    ctx.strokeStyle = 'rgba(245, 240, 200, 0.95)'; ctx.lineWidth = 2;
    const dashes = 6;
    for (let i = 0; i < dashes; i++) {
      const t0 = i / dashes, t1 = (i + 0.55) / dashes;
      const a = project(s.cx + s.dir.x * (t0 - 0.5) * s.len, s.h + 0.5, s.cz + s.dir.z * (t0 - 0.5) * s.len, cam, W, H, horizon);
      const b = project(s.cx + s.dir.x * (t1 - 0.5) * s.len, s.h + 0.5, s.cz + s.dir.z * (t1 - 0.5) * s.len, cam, W, H, horizon);
      if (a.behind || b.behind) continue;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // Threshold bars across both ends.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; ctx.lineWidth = 3;
    for (const tt of [0.03, 0.97]) {
      const ax = s.cx + s.dir.x * (tt - 0.5) * s.len - px * hw * 0.8;
      const az = s.cz + s.dir.z * (tt - 0.5) * s.len - pz * hw * 0.8;
      const bx = s.cx + s.dir.x * (tt - 0.5) * s.len + px * hw * 0.8;
      const bz = s.cz + s.dir.z * (tt - 0.5) * s.len + pz * hw * 0.8;
      const pa = project(ax, s.h + 0.5, az, cam, W, H, horizon);
      const pb = project(bx, s.h + 0.5, bz, cam, W, H, horizon);
      if (pa.behind || pb.behind) continue;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    // Edge lights.
    ctx.fillStyle = '#37e0ff';
    const lightSpots = [
      [-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl],
      [-hw, 0], [hw, 0],
    ];
    for (const [ox, oz] of lightSpots) {
      const p = project(s.cx + px * ox + s.dir.x * oz, s.h + 1, s.cz + pz * ox + s.dir.z * oz, cam, W, H, horizon);
      if (!p.behind) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
    }
    if (s.deck) {
      // Island superstructure: a small tower on the deck's right edge.
      const tx = s.cx + px * (hw * 0.82) + s.dir.x * (s.len * 0.18);
      const tz = s.cz + pz * (hw * 0.82) + s.dir.z * (s.len * 0.18);
      const base = project(tx, s.h, tz, cam, W, H, horizon);
      const topP = project(tx, s.h + 24, tz, cam, W, H, horizon);
      if (!base.behind && !topP.behind) {
        const w = Math.max(3, 26 * base.scale);
        const hgt = base.y - topP.y;
        if (hgt > 3) {
          ctx.fillStyle = '#232833';
          ctx.fillRect(base.x - w / 2, topP.y, w, hgt);
          ctx.fillStyle = 'rgba(255, 214, 120, 0.9)';
          ctx.fillRect(base.x - w / 2 + 3, topP.y + 5, 4, 5);
          ctx.fillRect(base.x + w / 2 - 7, topP.y + 5, 4, 5);
          ctx.fillStyle = 'rgba(255, 80, 80, 0.95)';
          ctx.fillRect(base.x - 2, topP.y - 3, 4, 3);
        }
      }
    }
  }
}

// Rain streaks, drawn over the scene but under the aircraft.
function drawRain(ctx, W, H, t) {
  ctx.save();
  ctx.strokeStyle = 'rgba(207, 228, 255, 0.30)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < 150; i++) {
    const sx = ((hashNoise(i, 1, 201) * (W + 160) + t * 620) % (W + 160)) - 80;
    const sy = ((hashNoise(i, 3, 202) * (H + 120) + t * 1050) % (H + 120)) - 60;
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx - 7, sy + 24);
  }
  ctx.stroke();
  ctx.restore();
}

// Render one frame of the chase view. cam = {x, y, z, heading, pitch}.
export function renderScene(ctx, W, H, cam, plane, mission, rings, t) {
  const pal = missionPalette(mission);
  const horizon = H * 0.46 - cam.pitch * H * 0.35;
  drawSky(ctx, W, H, pal, t, cam, mission);
  drawTerrain(ctx, W, H, horizon, cam, mission, pal);
  // Haze band softens the terrain/sky seam: golden dust, valley mist.
  if (pal.haze > 0.05) {
    const hg = ctx.createLinearGradient(0, horizon - H * 0.16, 0, horizon + H * 0.10);
    hg.addColorStop(0, 'rgba(0,0,0,0)');
    hg.addColorStop(0.55, `rgba(${pal.fog[0]},${pal.fog[1]},${pal.fog[2]},${(pal.haze * 0.45).toFixed(2)})`);
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg; ctx.fillRect(0, horizon - H * 0.16, W, H * 0.26);
  }
  drawRunway(ctx, cam, W, H, horizon, mission);
  if (mission === 'm4') {
    drawStreetlights(ctx, cityLights(), cam, W, H, horizon, t);
    drawBuildings(ctx, cityBuildings(), cam, W, H, horizon, t);
  }

  // Rings, far to near so near ones overlap correctly.
  const sorted = rings.map((r, i) => ({ r, i })).sort((a, b) => {
    const da = Math.hypot(a.r.x - cam.x, a.r.z - cam.z);
    const db = Math.hypot(b.r.x - cam.x, b.r.z - cam.z);
    return db - da;
  });
  for (const { r, i } of sorted) drawRing(ctx, r, cam, W, H, horizon, t, i < plane.ringsPassed);

  if (pal.rain) drawRain(ctx, W, H, t);

  // The aircraft, low and centred, banking with the roll.
  drawAircraft(ctx, W / 2, H * 0.68, H * 0.085, plane, t);
}
