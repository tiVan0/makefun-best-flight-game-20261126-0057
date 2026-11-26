// hud.js — the lit instruments: digital altitude/speed/heading, compass tape,
// fuel and throttle gauges, artificial horizon and centre messages.

function fmt(n, digits) {
  return n.toFixed(digits === undefined ? 0 : digits);
}

export function buildHud(root) {
  root.innerHTML = `
  <div class="hud hud-tl">
    <div class="gauge"><span class="lbl">ALT</span><span class="val" id="hud-alt">0</span><span class="unit">m</span></div>
    <div class="gauge"><span class="lbl">SPD</span><span class="val" id="hud-spd">0</span><span class="unit">km/h</span></div>
    <div class="gauge"><span class="lbl">HDG</span><span class="val" id="hud-hdg">000°</span></div>
    <div class="gauge"><span class="lbl">V/S</span><span class="val" id="hud-vs">+0</span><span class="unit">m/s</span></div>
  </div>
  <div class="hud hud-tc">
    <div id="hud-mission">Misi 1 — Lembah Kabut</div>
    <div id="hud-objective">Terbang menembus 6 cincin</div>
    <div id="hud-rings" class="rings"></div>
    <div id="hud-compass"><div id="hud-tape"></div><div class="needle">▲</div></div>
  </div>
  <div class="hud hud-tr">
    <div class="gauge"><span class="lbl">SCORE</span><span class="val" id="hud-score">0</span></div>
    <div class="gauge"><span class="lbl">WAKTU</span><span class="val" id="hud-time">0:00</span></div>
  </div>
  <div class="hud hud-bl">
    <div class="bar-row"><span class="lbl">THR</span><div class="bar"><div id="hud-thr" class="fill thr"></div></div><span id="hud-thr-v" class="val-sm">62%</span></div>
    <div class="bar-row"><span class="lbl">FUEL</span><div class="bar"><div id="hud-fuel" class="fill fuel"></div></div><span id="hud-fuel-v" class="val-sm">100%</span></div>
    <div class="bar-row"><span class="lbl">BOOST</span><div class="bar"><div id="hud-boost" class="fill boost"></div></div><span id="hud-boost-v" class="val-sm">100%</span></div>
  </div>
  <div class="hud hud-br"><canvas id="hud-horizon" width="120" height="120"></canvas><div class="lbl">HORIZON</div></div>
  <div id="hud-msg"></div>
  <div id="hud-warn"></div>`;
}

function drawHorizon(canvas, roll, pitch) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, 52, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-roll);
  ctx.translate(0, pitch * 90);
  ctx.fillStyle = '#2f6fb4'; ctx.fillRect(-60, -60, 120, 60);
  ctx.fillStyle = '#7a5a34'; ctx.fillRect(-60, 0, 120, 60);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(60, 0); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#ffd23c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 52, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffd23c';
  ctx.fillRect(cx - 22, cy - 1, 14, 3); ctx.fillRect(cx + 8, cy - 1, 14, 3);
  ctx.beginPath(); ctx.arc(cx, cy - 1, 3, 0, Math.PI * 2); ctx.fill();
}

let lastWarn = 0;
export function updateHud(plane, mission, rings, now) {
  const $ = (id) => document.getElementById(id);
  $('hud-alt').textContent = fmt(Math.max(0, plane.y));
  $('hud-spd').textContent = fmt(plane.speed * 3.6);
  let hdg = Math.round(((plane.heading * 180 / Math.PI) % 360 + 360) % 360);
  $('hud-hdg').textContent = String(hdg).padStart(3, '0') + '°';
  $('hud-vs').textContent = (plane.verticalSpeed >= 0 ? '+' : '') + fmt(plane.verticalSpeed, 1);
  $('hud-score').textContent = plane.score;
  const mm = Math.floor(plane.time / 60), ss = Math.floor(plane.time % 60);
  $('hud-time').textContent = mm + ':' + String(ss).padStart(2, '0');
  $('hud-mission').textContent = mission.name;
  $('hud-objective').textContent = mission.objective;
  $('hud-thr').style.width = (plane.throttle * 100) + '%';
  $('hud-thr-v').textContent = Math.round(plane.throttle * 100) + '%';
  $('hud-fuel').style.width = plane.fuel + '%';
  $('hud-fuel-v').textContent = Math.round(plane.fuel) + '%';
  $('hud-boost').style.width = plane.boost + '%';
  $('hud-boost-v').textContent = Math.round(plane.boost) + '%';
  $('hud-fuel').classList.toggle('low', plane.fuel < 25);

  // Ring progress dots.
  const dots = rings.map((r, i) => `<span class="dot${i < plane.ringsPassed ? ' done' : ''}">${r.final ? '★' : '○'}</span>`).join('');
  $('hud-rings').innerHTML = dots;

  // Compass tape: heading ticks every 30 degrees.
  let tape = '';
  for (let d = -90; d <= 90; d += 30) {
    let deg = (hdg + d + 360) % 360;
    const label = deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : String(deg).padStart(3, '0');
    tape += `<span class="tick" style="left:${50 + d / 3}%">${label}</span>`;
  }
  $('hud-tape').innerHTML = tape;

  drawHorizon($('hud-horizon'), plane.roll, plane.pitch);

  // Warnings, throttled.
  const warn = $('hud-warn');
  if (now - lastWarn > 400) {
    lastWarn = now;
    if (plane.fuel < 25 && plane.fuel > 0) warn.textContent = '⚠ LOW FUEL';
    else if (plane.y < 45) warn.textContent = '⚠ TERRAIN — PULL UP';
    else warn.textContent = '';
  }
}

export function showMessage(text, sub) {
  const el = document.getElementById('hud-msg');
  el.innerHTML = `<div class="msg-main">${text}</div>${sub ? `<div class="msg-sub">${sub}</div>` : ''}`;
  el.classList.add('show');
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => el.classList.remove('show'), 2600);
}
