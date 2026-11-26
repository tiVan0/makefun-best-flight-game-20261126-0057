# Operasi Garuda Senja

[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/tiVan0/makefun-best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/tiVan0/makefun-best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

A complete cinematic chase-view flight game, built for the make.fun bounty
[Make the best flight game](https://make.fun/bounty/best-flight-game-20261126-0057).

## The story

Andra "Elang" Prasetyo flies the air bridge for the island federation of
Kepulauan Senja — medicine, mail and hope, one valley at a time. Four
story missions, and every one ends in a landing:

1. **Lembah Kabut** — a green mountain valley in the rain; thread 6 marker
   rings between the peaks, then put the plane down on the village strip.
2. **Ngarai Emas** — a desert canyon at golden hour, dust haze on the
   horizon; 8 rings, strong wind, then land on the desert strip.
3. **Laut Bintang** — a moonless night sea; hop 7 rings between lit islands,
   then land on a floating carrier deck in the middle of the sea.
4. **Kota Neon** — the finale; fly between glowing towers, thread 8 rings,
   and land on the city runway — the landing the whole archipelago waited for.

## How to fly

- **← → / A D** — bank and turn
- **↑ ↓ / W S** — pitch up and down
- **Shift / Ctrl** — throttle up and down
- **Space** — boost (limited energy)
- **G** — landing gear down / up
- **R** — restart the mission · **P** — pause · **M** — mute

Throttle sets speed, banking turns the plane, pitch trades speed for climb.
Fuel drains with throttle and rings refund some of it. Fly slow and nose-high
and the plane stalls. After the final ring, fly the glidepath down to the
strip: touch down soft and centred for a landing score — too hard, off the
strip, or sideways, and the sortie ends in damage or a crash. Touch terrain —
or run dry — and the sortie ends.

## What is inside

- `game/index.html` — the page: canvas, HUD shell, overlay.
- `game/css/style.css` — the lit-instrument HUD and briefing overlay.
- `game/js/main.js` — bootstrap, game loop, input, mission state machine.
- `game/js/world.js` — seeded terrain heightfields, airfields with flattened
  ground, palettes, ring courses, city towers and street lights.
- `game/js/flight.js` — the flight model, landing and touchdown scoring,
  stall, damage, and the chase-view aircraft art.
- `game/js/render.js` — the voxel terrain renderer with relief shading,
  layered clouds, rain and haze, runways, rings and the city.
- `game/js/missions.js` — the story, the four sorties, the landing
  autopilot.
- `game/js/audio.js` — every sound synthesised live with WebAudio.
- `game/js/hud.js` — altitude, speed, heading, compass, fuel, gear, damage,
  horizon, and the landing banner.
- `main.ts` — the hand-in program (Node 22, stdlib only).

Everything is original: the idea, the art, the sounds and the names were made
for this bounty. The game is plain static files under `game/` — no build step,
no network request. Serve it with any static server, e.g.
`python3 -m http.server 8080 --directory game`, and open it in desktop Chrome.

## License

MIT — see `LICENSE`.
