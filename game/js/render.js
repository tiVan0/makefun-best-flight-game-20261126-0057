// render.js — the chase-view renderer: sky, voxel terrain flyover, rings,
// city towers and the runway, all drawn on one 2D canvas, no assets.

import { terrainHeight, groundColor, missionPalette, fogBlend, cityBuildings, hashNoise } from './world.js';
import { drawAircraft } from './flight.js';

const COLS = 420;          // voxel columns across the screen
const STEPS = 110;         // samples along each ray
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

function drawSky(ctx, W, H, pal, t, cam, mission) {
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  g.addColorStop(0, pal.skyTop); g.addColorStop(0.55, pal.skyMid); g.addColorStop(1, pal.skyBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.62);

  // Sun or moon.
  const sx = W * pal.sunX, sy = H * pal.sunY;
  const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, H * 0.22);
  glow.addColorStop(0, pal.sun); glow.addColorStop(0.35, pal.night ? 'rgba(220,228,255,0.35)' : 'rgba(255,240,190,0.5)');
  glow.addColorStop(1, 'rgba(255,240,190,0)');
  ctx.fillStyle = glow; ctx.fillRect(sx - H * 0.22, sy - H * 0.22, H * 0.44, H * 0.44);
  ctx.fillStyle = pal.sun;
  ctx.beginPath(); ctx.arc(sx, sy, pal.night ? H * 0.028 : H * 0.04, 0, Math.PI * 2); ctx.fill();

  // Stars at night, drifting clouds by day and night.
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
  ctx.fillStyle = pal.night ? 'rgba(120,140,190,0.16)' : 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 7; i++) {
    const cx = ((hashNoise(i, 11, 93) * W + t * (6 + i * 2)) % (W + 260)) - 130;
    const cy = H * (0.08 + hashNoise(i, 13, 94) * 0.2);
    const cw = 90 + hashNoise(i, 17, 95) * 130;
    ctx.beginPath(); ctx.ellipse(cx, cy, cw, cw * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Distant ridge silhouettes, parallaxed by heading, so the horizon reads
  // as mountains even where the voxel terrain runs low.
  const horizon = H * 0.46 - cam.pitch * H * 0.35;
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
    let d = 7;
    for (let s = 0; s < STEPS; s++) {
      d *= 1.062;
      if (d > FAR) break;
      const px = cam.x + dx * d, pz = cam.z + dz * d;
      const h = terrainHeight(px, pz, mission);
      // Ground below the camera appears below the horizon; ground above it
      // (a mountain taller than the plane) pokes above the horizon line.
      const y = horizon + ((cam.y - h) / d) * proj;
      if (y < top[c] && y < H + 2) {
        const fogT = Math.min(1, d / (FAR * 0.75));
        const base = groundColor(h, px, pz, mission, d);
        const col = fogBlend(base, pal.fog, fogT);
        ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
        const x0 = (c / COLS) * W;
        ctx.fillRect(x0, y, W / COLS + 1, top[c] - y);
        top[c] = y;
      }
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
    ctx.fillStyle = '#0c0e1c';
    ctx.fillRect(base.x - w / 2, topP.y, w, hgt);
    ctx.fillStyle = 'rgba(255, 214, 120, 0.85)';
    const rows = Math.max(1, Math.floor(hgt / 14)), colsN = Math.max(1, Math.floor(w / 12));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < colsN; j++) {
        if (hashNoise(i * 7 + j, b.x, 61) > 0.55) {
          ctx.fillRect(base.x - w / 2 + 4 + j * 12, topP.y + 5 + i * 14, 4, 5);
        }
      }
    }
    ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';
    if ((t % 1.4) < 0.7) ctx.fillRect(base.x - 2, topP.y - 3, 4, 3);
  }
}

function drawRunway(ctx, cam, W, H, horizon, mission) {
  if (mission !== 'm4') return;
  const rz = 5200, rx = 0;
  const corners = [[-26, rz], [26, rz], [26, rz + 620], [-26, rz + 620]];
  const pts = corners.map(([x, z]) => project(x, 0, z, cam, W, H, horizon));
  if (pts.some((p) => p.behind)) return;
  ctx.fillStyle = '#23262e';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineTo(pts[2].x, pts[2].y); ctx.lineTo(pts[3].x, pts[3].y);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f5f0c8'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo((pts[0].x + pts[3].x) / 2, (pts[0].y + pts[3].y) / 2);
  ctx.lineTo((pts[1].x + pts[2].x) / 2, (pts[1].y + pts[2].y) / 2); ctx.stroke();
  ctx.fillStyle = '#37e0ff';
  for (const [x, z] of [[-30, rz + 40], [30, rz + 40], [-30, rz + 580], [30, rz + 580]]) {
    const p = project(x, 2, z, cam, W, H, horizon);
    if (!p.behind) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
  }
}

// Render one frame of the chase view. cam = {x, y, z, heading, pitch}.
export function renderScene(ctx, W, H, cam, plane, mission, rings, t) {
  const pal = missionPalette(mission);
  const horizon = H * 0.46 - cam.pitch * H * 0.35;
  drawSky(ctx, W, H, pal, t, cam, mission);
  drawTerrain(ctx, W, H, horizon, cam, mission, pal);
  if (mission === 'm4') drawBuildings(ctx, cityBuildings(), cam, W, H, horizon, t);
  drawRunway(ctx, cam, W, H, horizon, mission);

  // Rings, far to near so near ones overlap correctly.
  const sorted = rings.map((r, i) => ({ r, i })).sort((a, b) => {
    const da = Math.hypot(a.r.x - cam.x, a.r.z - cam.z);
    const db = Math.hypot(b.r.x - cam.x, b.r.z - cam.z);
    return db - da;
  });
  for (const { r, i } of sorted) drawRing(ctx, r, cam, W, H, horizon, t, i < plane.ringsPassed);

  // The aircraft, low and centred, banking with the roll.
  drawAircraft(ctx, W / 2, H * 0.68, H * 0.085, plane, t);
}
