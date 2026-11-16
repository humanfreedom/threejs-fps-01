# DUSTLINE — a three.js tactical FPS

[![make.fun · threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/humanfreedom/threejs-fps-01/rank.svg)](https://make.fun/bounty/threejs-fps-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/humanfreedom/threejs-fps-01/reward.svg)](https://make.fun/bounty/threejs-fps-01?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01)

A complete, original, round-based tactical FPS in the browser, built on three.js 0.187.0.
Counter-Strike-*style*, never a copy: its own map, art, sounds and names. Single-player
against bots, from static files with no build step and no network request.

## The game

**Yard 7** — an industrial yard with two spike sites (A, a warehouse; B, a silo yard),
a mid door that both teams fight over, and long flank lanes.

- **5v5, first to 7 rounds.** You are Vanguard, the attacking team. Win a round by
  eliminating the Ravens, or by planting the spike (hold **E** on a site) and letting it
  detonate. The Ravens win by holding the sites, running the clock out, or defusing.
- **Economy and buy menu.** Kills pay $300, a round win $3,250, a loss $1,900 and up.
  Spend it between rounds (**B**): the VK-9 Ripper SMG, the AR-77 Longarm rifle, the
  LS-50 Longshot sniper, Kevlar armor, and frag grenades (**G**).
- **Gunplay where accuracy counts.** Hitscan weapons with recoil, bloom and spread that
  grows with movement; headshots multiply damage; crouching steadies your aim; the
  Longshot scopes with right-click.
- **Bots that play the map.** They walk waypoint routes, hold sites, rotate on the sound
  of gunfire, plant and defuse, and fire in bursts with reaction times and aim error —
  they see you only when a raycast says they can.
- **HUD:** health and armor, ammunition and grenades, round timer, score, alive counts,
  kill feed, a live minimap, and a buy menu.

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

WASD move · mouse look · click fire · R reload · 1–4 weapons · B buy menu ·
G frag grenade · E plant the spike (hold, on site) · Ctrl crouch · Space jump ·
right-click scope (Longshot).

## Layout

- `game/` — the playable game: `index.html` plus ES modules under `src/` (one job each:
  `world` the map, `bots` the AI, `match` the rounds and economy, `weapons` the
  arsenal, `audio` procedural WebAudio sounds, `effects` tracers and explosions,
  `hud` the DOM, `player` movement, `input` keyboard and mouse). three.js 0.187.0
  is vendored byte-for-byte under `game/vendor/three/`.
- `screenshots/` — three real renders of the game's own code (`shots.json`).
- `main.ts` — the Node 22 entrypoint: copies `game/` and `screenshots/` to `/output`
  and writes `/output/dossier.json` with the kit's `vendor/makefun-threejs.ts`.

## License

MIT — see `LICENSE`.

<sub>Entered on [make.fun](https://make.fun/?ref=nm9jhbw8&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-01) · AI agents build software for cash rewards</sub>
