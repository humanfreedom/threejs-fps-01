// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
//
// DUSTLINE: a round-based tactical FPS on Yard 7. You are Vanguard, the attacking
// team: five against five, first to 7 rounds. Plant the spike at site A or B, or
// eliminate the Ravens. Between rounds, spend the money you earned in the buy menu.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponSet, WEAPONS, GRENADE } from './weapons.js';
import { createBots } from './bots.js';
import { createMatch } from './match.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
const PLANT_SECONDS = 3.2;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.surface), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const effects = createEffects(scene);
const hud = createHud();
const player = createPlayer(world.colliders);
const weapons = createWeaponSet(camera);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 100;
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

const body = player.state;
let health = 100;
let playerAlive = true;
let matchStarted = false;
let frozen = false;
let started = false;
let scoped = false;
let plantProgress = 0;
let lastPlantBeep = 0;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let mapAt = 0;
const grenades = [];
const EMPTY_KEYS = new Set();

// The spike: a dark case with a blinking amber light, shown where it is planted.
const spike = new THREE.Group();
const spikeCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.26, 0.32),
  new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242a'), roughness: 0.6, metalness: 0.3 }),
);
spikeCase.position.y = 0.13;
spikeCase.castShadow = true;
const spikeLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 10, 8),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
spikeLight.position.set(0, 0.32, 0);
spike.add(spikeCase, spikeLight);
spike.visible = false;
scene.add(spike);

const bots = createBots(scene, world, {
  onRoundPlan(site) { match.setTargetSite(site); },
  onShot(bot, from, end, impact) {
    effects.tracer(from, end);
    if (impact) effects.impact(impact);
    audio.shot(bot.weapon.gap < 0.1 ? 'smg' : 'rifle', bot.position.distanceTo(body.position));
    bots.hearShot(end);
  },
  onBotHit(bot, damage, head, shooter) {
    const killed = bots.damage(bot, damage, head ? 'head' : 'torso');
    if (killed) match.onKill(shooter.name, shooter.team, bot.name, head, false);
  },
  onPlayerHit(damage, fromBot, head) {
    if (!playerAlive || shot) return;
    health -= damage;
    hud.damageFlash();
    hud.setHealth(health, match.state.armor);
    audio.hurt();
    if (health <= 0) killPlayer(fromBot.name);
  },
  onBotKilled() { updateAlive(); },
  onPlantProgress(bot, progress) { match.onPlantProgress(progress, elapsed); },
  onPlanted(bot, site) {
    match.onPlanted(site, false);
    placeSpike(site);
  },
  onDefuseProgress(bot, progress) { match.onDefuseProgress(progress, elapsed); },
  onDefused() {
    spike.visible = false;
    hud.hideSpike();
    match.onDefused();
  },
});

const match = createMatch({
  onBuyStart(round) {
    resetForRound(round);
    hud.setRound(round);
    hud.setScore(match.state.score.vanguard, match.state.score.raven);
    hud.setMoney(match.state.money);
    if (!shot) hud.showBuy(match.state.money, weapons.owned, match.state.armor, weapons.state.grenades);
    else hud.showBuy(match.state.money, weapons.owned, match.state.armor, weapons.state.grenades);
  },
  onRoundStart(round, site) {
    hud.hideBuy();
    hud.banner(`ROUND ${round}`, `Take site ${site} — plant the spike or eliminate the Ravens`);
  },
  onRoundEnd(winner, reason, v, r) {
    hud.setScore(v, r);
    hud.hideSpike();
    hud.banner(
      winner === 'vanguard' ? 'ROUND WON' : 'ROUND LOST',
      `${reason} · ${v} — ${r}`,
    );
  },
  onMatchEnd(winner, v, r) {
    hud.hideBuy();
    if (document.pointerLockElement) document.exitPointerLock();
    hud.showOverlay('matchEnd', `${winner === 'vanguard' ? 'Vanguard takes the match' : 'Ravens take the match'} — ${v} to ${r}.`);
  },
  onTimer(seconds, phase) { hud.setTimer(seconds, phase); },
  onMoney(value) { hud.setMoney(value); },
  onScore(v, r) { hud.setScore(v, r); },
  onKillFeed(text) { hud.killFeed(text); },
  onSpikePlanted(site) {
    hud.showSpike(site, 35);
    audio.plantBeep();
  },
  onSpikeDefused() { hud.hideSpike(); },
  onSpikeExploded(site) {
    const center = SITES[site].center;
    effects.explosion(center);
    audio.explosion(center.distanceTo(body.position));
    spike.visible = false;
    hud.hideSpike();
  },
  onSpikeTick() { audio.spikeTick(); },
  onPlantProgress(progress) { hud.setPlantProgress(progress); },
  onDefuseProgress(progress) { hud.setDefuseProgress(progress); },
  onRoundWinSound() { audio.roundWin(); },
  onRoundLoseSound() { audio.roundLose(); },
  onBuySound() { audio.buy(); },
});

function placeSpike(site) {
  const center = SITES[site].center;
  spike.position.set(center.x, 0, center.z);
  spike.visible = true;
}

function updateAlive() {
  let v = playerAlive ? 1 : 0;
  let r = 0;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    if (bot.team === 'vanguard') v += 1;
    else r += 1;
  }
  hud.setAlive(v, r);
}

function resetPlayer() {
  const spawn = SPAWNS.vanguard[0];
  body.position.copy(spawn);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  body.eye = 1.6;
  health = 100;
  playerAlive = true;
  plantProgress = 0;
  grenades.length = 0;
  hud.setHealth(100, match.state.armor);
  updateAlive();
  syncCamera();
}

function resetForRound() {
  bots.resetRound(match.state.round, random);
  resetPlayer();
  weapons.resetRound();
  spike.visible = false;
  hud.hideSpike();
  hud.setPlantProgress(0);
  hud.setDefuseProgress(0);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades, weapons.def().name);
  setScope(false);
}

function killPlayer(killerName) {
  playerAlive = false;
  health = 0;
  setScope(false);
  match.onPlayerDeath();
  match.resetArmor();
  hud.setHealth(0, false);
  hud.killFeed(`${killerName} ▸ You`);
  if (document.pointerLockElement) document.exitPointerLock();
  if (!shot) hud.showOverlay('dead');
  updateAlive();
}

function buyItem(id) {
  if (match.state.phase !== 'buy') { audio.deny(); return; }
  if (id === 'armor') {
    const result = match.buyArmor();
    if (!result.ok) audio.deny();
  } else if (id === 'grenade') {
    if (weapons.state.grenades >= GRENADE.max) {
      audio.deny();
    } else {
      const result = match.buyGrenade();
      if (result.ok) weapons.addGrenade();
      else audio.deny();
    }
  } else {
    const def = WEAPONS[id];
    if (!def) return;
    if (weapons.owned.has(id)) {
      weapons.equip(id);
    } else {
      const result = match.buyWeapon(id);
      if (result.ok) weapons.buy(id);
      else audio.deny();
    }
  }
  hud.refreshBuy(match.state.money, weapons.owned, match.state.armor, weapons.state.grenades);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades, weapons.def().name);
}

hud.onBuy((id) => buyItem(id));
hud.onBuyClose(() => {
  hud.hideBuy();
  if (!shot) input.requestLock();
});
hud.onPlay(() => {
  audio.unlock();
  if (!matchStarted) {
    matchStarted = true;
    weapons.resetMatch();
    match.startMatch();
  } else if (match.state.phase === 'matchEnd') {
    weapons.resetMatch();
    match.startMatch();
  }
  hud.hideOverlay();
  hud.hideBuy();
  if (!shot) input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (match.state.phase === 'buy') hud.showBuy(match.state.money, weapons.owned, match.state.armor, weapons.state.grenades);
  } else if (matchStarted) {
    if (match.state.phase === 'live' && playerAlive) hud.showOverlay('paused');
    else if (match.state.phase === 'buy') hud.showBuy(match.state.money, weapons.owned, match.state.armor, weapons.state.grenades);
  }
}

function setScope(on) {
  if (scoped === on) return;
  scoped = on;
  camera.fov = on ? 30 : 74;
  camera.updateProjectionMatrix();
  hud.setScope(on);
}

window.addEventListener('contextmenu', (event) => event.preventDefault());
window.addEventListener('mousedown', (event) => {
  if (event.button === 2 && input.state.locked && playerAlive && weapons.def().scope) setScope(true);
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 2) setScope(false);
});

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!weapons.takeRound()) {
    audio.dryFire();
    return false;
  }
  const def = weapons.def();
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  muzzle.copy(camera.position);
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  raycaster.far = def.range;
  const shootables = world.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(shootables, false)[0];
  const end = hit ? hit.point : tmpVec.copy(camera.position).addScaledVector(direction, def.range);
  effects.tracer(muzzle, end);
  if (hit) {
    const hitBot = hit.object.userData.bot;
    if (hitBot) {
      const head = hit.object.userData.part === 'head';
      const damage = def.damage * (head ? def.headMult : 1) * (hitBot.armor ? 0.5 : 1);
      const killed = bots.damage(hitBot, damage, head ? 'head' : 'torso');
      hud.hitMarker(killed, shot ? 4000 : 90);
      audio.hit(head);
      if (killed) {
        match.onKill('You', 'vanguard', hitBot.name, head, true);
        audio.kill();
      }
    } else {
      effects.impact(hit.point);
    }
  }
  weapons.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  bots.hearShot(body.position);
  audio.shot(def.id, 0);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades, def.name);
  return true;
}

function throwGrenade() {
  if (!weapons.throwGrenade()) return;
  camera.getWorldDirection(direction);
  grenades.push({
    pos: camera.position.clone().addScaledVector(direction, 0.5),
    vel: direction.clone().multiplyScalar(15).add(new THREE.Vector3(0, 3.5, 0)),
    fuse: GRENADE.fuse,
  });
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades, weapons.def().name);
}

function explodeGrenade(g) {
  effects.explosion(g.pos);
  audio.explosion(g.pos.distanceTo(body.position));
  const radius = GRENADE.radius;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = bot.position.distanceTo(g.pos);
    if (d > radius) continue;
    const damage = GRENADE.damage * (1 - d / radius) * (bot.armor ? 0.5 : 1);
    const killed = bots.damage(bot, damage, 'torso');
    if (killed) match.onKill('You', 'vanguard', bot.name, false, true);
  }
  const pd = body.position.distanceTo(g.pos);
  if (playerAlive && pd < radius) {
    health -= GRENADE.damage * (1 - pd / radius) * 0.5;
    hud.damageFlash();
    hud.setHealth(health, match.state.armor);
    if (health <= 0) killPlayer('a grenade');
  }
}

function botContext() {
  return {
    playerPos: body.position,
    playerAlive,
    playerCrouch: body.crouching,
    playerSpeed: player.groundSpeed(),
    playerArmor: match.state.armor,
    phase: match.state.phase,
    spikePlanted: match.state.spikePlanted,
    plantedSite: match.state.spikeSite,
    targetSite: match.state.targetSite,
  };
}

function handlePressed(pressed) {
  for (const code of pressed) {
    if (code === 'KeyB' && match.state.phase === 'buy' && matchStarted) {
      if (document.getElementById('buy-menu').hidden) {
        if (document.pointerLockElement) document.exitPointerLock();
        hud.showBuy(match.state.money, weapons.owned, match.state.armor, weapons.state.grenades);
      } else {
        hud.hideBuy();
        input.requestLock();
      }
    } else if (code === 'KeyG' && playerAlive && match.state.phase === 'live') {
      throwGrenade();
    } else if (code === 'KeyR' && playerAlive && match.state.phase === 'live') {
      // Reload is a tap, not a hold: a quick press between slow frames must
      // still register, so it goes through the edge set like B and G.
      if (weapons.reload()) audio.reload();
    } else if (code === 'KeyE' && playerAlive && match.state.phase === 'live') {
      // Planting is held, not tapped; see step().
    } else if (code.startsWith('Digit')) {
      const n = code.slice(5);
      const def = Object.values(WEAPONS).find((w) => String(w.slot) === n);
      if (def && weapons.owned.has(def.id) && playerAlive) {
        weapons.equip(def.id);
        setScope(false);
        hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades, def.name);
      } else if (n === '5') buyItem('armor');
      else if (n === '6') buyItem('grenade');
    }
  }
}

function step(dt) {
  elapsed += dt;
  const phase = match.state.phase;
  const frozenPlayer = phase === 'buy' || !playerAlive || phase === 'matchEnd';

  if (!frozenPlayer) {
    player.step(dt, input.state.keys);
  } else if (phase === 'buy') {
    // Stand still during the buy phase; the buy menu is the game.
    player.step(dt, EMPTY_KEYS);
  }
  const look = input.takeLook();
  if (playerAlive && input.state.locked) player.look(look.x * (scoped ? 0.4 : 1), look.y * (scoped ? 0.4 : 1));
  handlePressed(input.takePressed());

  if (playerAlive && phase === 'live') {
    if (input.state.firing && weapons.ready()) shoot(shot ? 0 : weapons.spread(player.groundSpeed()));
    // Planting: hold E inside a site while the spike is not planted.
    if (input.state.keys.has('KeyE') && !match.state.spikePlanted) {
      let site = null;
      for (const [name, s] of Object.entries(SITES)) {
        if (body.position.distanceTo(s.center) < s.radius) site = name;
      }
      if (site) {
        plantProgress += dt / PLANT_SECONDS;
        hud.setPlantProgress(Math.min(1, plantProgress));
        if (plantProgress - lastPlantBeep > 0.25) {
          lastPlantBeep = plantProgress;
          audio.plantBeep();
        }
        if (plantProgress >= 1) {
          plantProgress = 0;
          match.onPlanted(site, true);
          placeSpike(site);
        }
      } else if (plantProgress > 0) {
        plantProgress = 0;
        hud.setPlantProgress(0);
      }
    } else if (plantProgress > 0) {
      plantProgress = 0;
      hud.setPlantProgress(0);
    }
  }

  weapons.step(dt);
  effects.step(dt);
  bots.step(dt, botContext(), elapsed);
  if (matchStarted) match.step(dt, elapsed);

  // Grenades fly on the fixed step.
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vel.y -= 20 * dt;
    g.pos.addScaledVector(g.vel, dt);
    if (g.pos.y <= 0.08 || g.fuse <= 0) {
      grenades.splice(i, 1);
      explodeGrenade(g);
    }
  }

  // Spike light blinks faster as the timer runs down.
  if (spike.visible) {
    const rate = match.state.spikePlanted ? Math.max(2, 10 - match.state.spikeTimer / 4) : 4;
    spikeLight.material.color.setHex(Math.sin(elapsed * rate) > 0 ? 0xf0a830 : 0x5a3a00);
  }

  // Alive counts and the minimap, throttled.
  if (elapsed - mapAt > 0.25) {
    mapAt = elapsed;
    updateAlive();
    hud.drawMinimap(body.position, body.yaw, bots.bots);
    match.checkElimination(
      playerAlive || bots.bots.some((b) => b.team === 'vanguard' && b.alive),
      bots.bots.some((b) => b.team === 'raven' && b.alive),
    );
  }
  hud.setCrosshair(weapons.spread(player.groundSpeed()));
  // Ammo changes when a reload finishes, not only when a shot is fired.
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades, weapons.def().name);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  matchStarted = true;
  weapons.resetMatch();
  match.startMatch();
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'start') {
    body.position.set(0, 0, 16.5);
    settle(20);
    syncCamera();
    hud.showBuy(match.state.money, weapons.owned, match.state.armor, weapons.state.grenades);
  } else if (name === 'play') {
    // Stage the rifle, as if bought in the buy phase, for the action shot.
    match.state.money = 4000;
    match.buyWeapon('rifle');
    weapons.buy('rifle');
    hud.setMoney(match.state.money);
    match.state.phase = 'live';
    match.state.timer = 88;
    hud.hideBuy();
    body.position.set(0, 0, 6);
    settle(45);
    // Stage one Raven in the open at the mid door so the shot lands on a bot.
    const target = bots.bots.find((b) => b.team === 'raven' && b.alive);
    if (target) {
      target.position.set(1.5, 0, -3);
      target.group.position.copy(target.position);
      target.yaw = 0;
      target.target = null;
      aimAt(new THREE.Vector3(target.position.x, target.position.y + 1.55, target.position.z));
      shoot(0);
      settle(1);
    }
    hud.setScore(0, 0);
  } else {
    // end: round won, spike detonated at A.
    match.state.score.vanguard = 1;
    match.state.phase = 'roundEnd';
    match.state.roundEndLeft = 4;
    hud.hideBuy();
    body.position.set(-12, 0, -5);
    aimAt(new THREE.Vector3(-17, 1, -11));
    settle(10);
    hud.setScore(1, 0);
    hud.setMoney(800 + 3250 + 300);
    hud.setTimer(0, 'roundEnd');
    hud.drawMinimap(body.position, body.yaw, bots.bots);
    hud.banner('ROUND WON', 'Spike detonated · 1 — 0');
  }
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.state.grenades, weapons.def().name);
  hud.setHealth(health, match.state.armor);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setAmmo(weapons.state.mag, weapons.state.reserve, 0, weapons.def().name);
hud.setHealth(100, false);
hud.setMoney(800);
hud.setScore(0, 0);
hud.setTimer(0, 'buy');
hud.setAlive(5, 5);
// Small debug handle for automated play-tests (read-only state + the bot list).
window.__dustline = {
  match: match.state,
  bots: bots.bots,
  weapons,
  get health() { return health; },
  get playerAlive() { return playerAlive; },
  damageBot(bot, amount) { return bots.damage(bot, amount, 'torso'); },
};
if (shot) runShot(shot);
else requestAnimationFrame(frame);
