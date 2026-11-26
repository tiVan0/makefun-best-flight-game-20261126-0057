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

function mixHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.substr(i, 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.substr(i, 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

// One cloud as a cluster of shaded puffs: bright crown, soft dark base.
function drawCloud(ctx, cx, cy, s, alpha, night) {
  const puffs = [[-0.42, 0.10, 0.40], [-0.12, -0.14, 0.52], [0.18, -0.06, 0.56], [0.48, 0.10, 0.42], [0.02, 0.14, 0.50]];
  ctx.save();
  // Dark underbelly first, offset down: the shadow is what makes the bright
  // crown read as volume instead of a flat sticker.
  ctx.globalAlpha = alpha * (night ? 0.5 : 0.26);
  for (const [ox, oy, r] of puffs) {
    const px = cx + ox * s, py = cy + (oy + 0.17) * s, pr = r * s * 1.06;
    const g = ctx.createRadialGradient(px, py, pr * 0.1, px, py, pr);
    g.addColorStop(0, night ? 'rgba(8,12,28,0.85)' : 'rgba(88,108,148,0.55)');
    g.addColorStop(1, 'rgba(88,108,148,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
  }
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
  // Five-stop sky: the extra mid stops keep the gradient rich instead of
  // washing out halfway to the horizon.
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  g.addColorStop(0, pal.skyTop);
  g.addColorStop(0.38, mixHex(pal.skyTop, pal.skyMid, 0.55));
  g.addColorStop(0.62, pal.skyMid);
  g.addColorStop(0.85, mixHex(pal.skyMid, pal.skyBot, 0.5));
  g.addColorStop(1, pal.skyBot);
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

  // Horizontal glare streak through the sun/moon: the bright lane that
  // makes a low sun feel blinding instead of a flat disc.
  const gx0 = Math.max(0, pal.sunX - 0.18), gx1 = Math.min(1, pal.sunX + 0.18);
  const glare = ctx.createLinearGradient(0, 0, W, 0);
  glare.addColorStop(0, 'rgba(255,255,255,0)');
  glare.addColorStop(gx0, 'rgba(255,255,255,0)');
  glare.addColorStop(pal.sunX, pal.night ? 'rgba(220,228,255,0.18)' : 'rgba(255,240,190,0.30)');
  glare.addColorStop(gx1, 'rgba(255,255,255,0)');
  glare.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glare;
  ctx.fillRect(0, sy - H * 0.012, W, H * 0.024);

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
    const pts = [];
    ctx.beginPath();
    ctx.moveTo(0, horizon + 2);
    for (let x = 0; x <= W; x += 8) {
      const n = hashNoise(Math.floor((x + shift) / 90) + layer * 40, 1, 97);
      const n2 = hashNoise(Math.floor((x + shift) / 34) + layer * 7, 2, 98);
      const yy = base - (n * 0.7 + n2 * 0.3) * amp;
      pts.push([x, yy]);
      ctx.lineTo(x, yy);
    }
    ctx.lineTo(W, horizon + 2);
    ctx.closePath(); ctx.fill();
    // Snowline on the far ridge in the valley mission: a pale crest line so
    // the horizon reads as snowy peaks, like the reference simulator shot.
    if (layer === 0 && mission === 'm1' && !pal.night) {
      ctx.strokeStyle = 'rgba(238,242,248,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
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
          shade = 1 + Math.max(-0.26, Math.min(0.34, slope * 0.10));
        }
        let col = fogBlend(base, pal.fog, fogT);
        // Moon glitter path on the night sea: the water catches the moon in
        // a bright lane under it, fading with distance.
        if (mission === 'm3' && h <= 0) {
          const gx = c / COLS - pal.sunX;
          const glint = Math.exp(-(gx * gx) / 0.008) * Math.max(0, 1 - d / 900) * 55;
          col = [col[0] + glint * 0.85, col[1] + glint, col[2] + glint * 1.25];
        }
        // Per-sample dither: 2D grain (varies along the ray as well as
        // across columns) that breaks the raymarcher's contour banding.
        // A per-column-only value would paint vertical stripes instead.
        const dith = (hashNoise(c * 3 + Math.floor(d / 28), 11, 55) - 0.5) * 5;
        col = [
          clamp255(col[0] * shade + 7 * sunSide + dith),
          clamp255(col[1] * shade + 2 * sunSide + dith),
          clamp255(col[2] * shade - 4 * sunSide + dith),
        ];
        ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
        const x0 = (c / COLS) * W;
        ctx.fillRect(x0, y, W / COLS + 1, top[c] - y);
        // Soften the stepped top edge of the voxel silhouette: a faint
        // fringe of the same colour above the edge anti-aliases the stairs.
        ctx.globalAlpha = 0.4;
        ctx.fillRect(x0, y - 2, W / COLS + 1, 2);
        ctx.globalAlpha = 1;
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
    const warm = L.c !== 1;
    // Halo first, then the hot core: each lamp glows instead of being a dot.
    ctx.fillStyle = warm
      ? `rgba(255, 190, 100, ${(0.10 * a).toFixed(2)})`
      : `rgba(180, 215, 255, ${(0.10 * a).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = warm
      ? `rgba(255, 200, 110, ${(0.75 * a).toFixed(2)})`
      : `rgba(190, 220, 255, ${(0.75 * a).toFixed(2)})`;
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
    // Windows: warm yellow, some cool cyan, a rare magenta neon — and more
    // of them lit, so the towers read as inhabited at night.
    const rows = Math.max(1, Math.floor(hgt / 14)), colsN = Math.max(1, Math.floor(w / 12));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < colsN; j++) {
        const n = hashNoise(i * 7 + j, b.x + b.seed * 100, 61);
        if (n > 0.42) {
          ctx.fillStyle = n > 0.96 ? 'rgba(255, 110, 220, 0.9)' : n > 0.9 ? 'rgba(120, 230, 255, 0.9)' : 'rgba(255, 214, 120, 0.85)';
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
  const pal = missionPalette(mission);
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
    // Asphalt: lighter at night so the strip surface reads instead of
    // staying a black hole, plus a faint cool sheen wash.
    ctx.fillStyle = pal.night ? '#2e323e' : '#23262e';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineTo(pts[2].x, pts[2].y); ctx.lineTo(pts[3].x, pts[3].y);
    ctx.closePath(); ctx.fill();
    if (pal.night) {
      ctx.fillStyle = 'rgba(170, 195, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y);
      ctx.lineTo(pts[2].x, pts[2].y); ctx.lineTo(pts[3].x, pts[3].y);
      ctx.closePath(); ctx.fill();
    }
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
    // Touchdown zone: pairs of white bars a quarter and halfway down the
    // strip, left and right of the centreline.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)'; ctx.lineWidth = 2;
    for (const tt of [0.25, 0.5]) {
      for (const [f0, f1] of [[-0.75, -0.35], [0.35, 0.75]]) {
        const pa = project(s.cx + s.dir.x * (tt - 0.5) * s.len + px * hw * f0, s.h + 0.5, s.cz + s.dir.z * (tt - 0.5) * s.len + pz * hw * f0, cam, W, H, horizon);
        const pb = project(s.cx + s.dir.x * (tt - 0.5) * s.len + px * hw * f1, s.h + 0.5, s.cz + s.dir.z * (tt - 0.5) * s.len + pz * hw * f1, cam, W, H, horizon);
        if (pa.behind || pb.behind) continue;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
    }
    // Edge lights, with a glow so they read as lamps at night.
    ctx.fillStyle = '#37e0ff';
    ctx.shadowColor = '#37e0ff'; ctx.shadowBlur = 9;
    const lightSpots = [
      [-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl],
      [-hw, 0], [hw, 0],
    ];
    for (const [ox, oz] of lightSpots) {
      const p = project(s.cx + px * ox + s.dir.x * oz, s.h + 1, s.cz + pz * ox + s.dir.z * oz, cam, W, H, horizon);
      if (!p.behind) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.shadowBlur = 0;
    if (s.kind === 'final') {
      // Approach light bar: five bright dots marching toward the threshold.
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 10;
      for (let i = 1; i <= 5; i++) {
        const p = project(s.cx - s.dir.x * (s.len / 2 + i * 60), s.h + 1, s.cz - s.dir.z * (s.len / 2 + i * 60), cam, W, H, horizon);
        if (!p.behind) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.shadowBlur = 0;
      // PAPI: two white, two red beside the threshold — on glidepath.
      for (let i = 0; i < 4; i++) {
        const off = hw + 16 + i * 11;
        const p = project(s.cx + s.dir.x * (0.06 - 0.5) * s.len + px * off, s.h + 1, s.cz + s.dir.z * (0.06 - 0.5) * s.len + pz * off, cam, W, H, horizon);
        if (p.behind) continue;
        ctx.fillStyle = i < 2 ? '#ffffff' : '#ff3b30';
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      }
      // Runway number at the threshold, rotated to the strip's screen angle.
      const nA = project(s.cx + s.dir.x * (0.10 - 0.5) * s.len, s.h + 0.6, s.cz + s.dir.z * (0.10 - 0.5) * s.len, cam, W, H, horizon);
      const nB = project(s.cx + s.dir.x * (0.22 - 0.5) * s.len, s.h + 0.6, s.cz + s.dir.z * (0.22 - 0.5) * s.len, cam, W, H, horizon);
      if (!nA.behind && !nB.behind) {
        const ang = Math.atan2(nB.y - nA.y, nB.x - nA.x);
        const size = Math.max(10, Math.min(46, Math.hypot(nB.x - nA.x, nB.y - nA.y) * 0.28));
        ctx.save();
        ctx.translate((nA.x + nB.x) / 2, (nA.y + nB.y) / 2);
        ctx.rotate(ang);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.font = `bold ${size | 0}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('27', 0, 0);
        ctx.restore();
      }
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

// Light pollution over the night city: a wide warm pool on the ground
// around the corridor, so the city reads as a glowing carpet, not dots.
function drawCityGlow(ctx, cam, W, H, horizon) {
  const p = project(0, 0, 4200, cam, W, H, horizon);
  if (p.behind) return;
  const rx = W * 0.42, ry = H * 0.10;
  ctx.save();
  ctx.translate(p.x, Math.min(p.y, H * 0.95));
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, rx);
  g.addColorStop(0, 'rgba(255, 176, 92, 0.16)');
  g.addColorStop(0.6, 'rgba(255, 160, 80, 0.08)');
  g.addColorStop(1, 'rgba(255, 160, 80, 0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Extra airframe detail painted over the chase-view plane (flight.js owns
// the plane itself and is not touched): spine highlight, belly shade,
// wingtip light halos and a dark engine nozzle with a bright core.
function drawAircraftDetail(ctx, cx, cy, s, plane, t, pal) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-plane.roll * 0.9);
  ctx.scale(1 + plane.speed / 900, 1);
  // Spine highlight: sun catching the top of the fuselage.
  const spine = ctx.createLinearGradient(0, -s * 0.62, 0, s * 0.1);
  spine.addColorStop(0, 'rgba(255,255,255,0.55)');
  spine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spine;
  ctx.beginPath(); ctx.ellipse(0, -s * 0.26, s * 0.055, s * 0.34, 0, 0, Math.PI * 2); ctx.fill();
  // Belly shade.
  const belly = ctx.createLinearGradient(0, s * 0.1, 0, s * 0.46);
  belly.addColorStop(0, 'rgba(20,26,40,0)');
  belly.addColorStop(1, 'rgba(20,26,40,0.4)');
  ctx.fillStyle = belly;
  ctx.beginPath(); ctx.ellipse(0, s * 0.28, s * 0.14, s * 0.18, 0, 0, Math.PI * 2); ctx.fill();
  // Engine nozzle: dark ring, bright core.
  ctx.fillStyle = '#20242e';
  ctx.beginPath(); ctx.ellipse(0, s * 0.40, s * 0.075, s * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255, 200, 110, 0.9)';
  ctx.beginPath(); ctx.ellipse(0, s * 0.40, s * 0.035, s * 0.025, 0, 0, Math.PI * 2); ctx.fill();
  // Wingtip light halos.
  const halo = (x, color) => {
    const g = ctx.createRadialGradient(x, s * 0.14, 1, x, s * 0.14, s * 0.16);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, s * 0.14, s * 0.16, 0, Math.PI * 2); ctx.fill();
  };
  halo(-s * 1.02, 'rgba(255,45,45,0.35)');
  halo(s * 1.02, 'rgba(45,255,94,0.35)');
  // Canopy glint, repainted over the spine highlight.
  ctx.fillStyle = 'rgba(140, 210, 255, 0.85)';
  ctx.beginPath(); ctx.ellipse(0, -s * 0.3, s * 0.07, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
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
  if (mission === 'm4') drawCityGlow(ctx, cam, W, H, horizon);
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

  // The aircraft, low and centred, banking with the roll, plus the extra
  // airframe detail layer.
  drawAircraft(ctx, W / 2, H * 0.68, H * 0.085, plane, t);
  drawAircraftDetail(ctx, W / 2, H * 0.68, H * 0.085, plane, t, pal);
}
