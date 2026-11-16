// The bots: nine opponents and teammates who walk the waypoint graph, hold
// positions, hear shots, see enemies, fire in bursts, plant the spike and
// defuse it. One state machine per bot, driven by the fixed-step simulation.
// Bots never see through walls: every sighting is a raycast against the world.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS, SITES } from './world.js';

const RADIUS = 0.34;
const HEIGHT = 1.72;
const EYE = 1.5;
const HEALTH = 100;
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 5.0;
const PERCEIVE_EVERY = 0.12;
const SIGHT_RANGE = 30;
const ENGAGE_MOVE_RANGE = 22;

const VANGUARD_NAMES = ['Ash', 'Bram', 'Cy', 'Dara'];
const RAVEN_NAMES = ['Fenn', 'Grit', 'Hale', 'Ivo', 'Juno'];
const RAVEN_HOLDS = [21, 25, 22, 26, 18];

const WEAPON_DEFS = {
  rifle: { damage: 30, gap: 0.12, burst: 4 },
  smg: { damage: 22, gap: 0.09, burst: 6 },
};

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

function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  const nodes = WAYPOINTS.nodes;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i][0] - x;
    const dz = nodes[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function findPath(from, to) {
  if (from === to) return [to];
  const nodes = WAYPOINTS.nodes;
  const prev = new Array(nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const current = queue.shift();
    for (const [a, b] of WAYPOINTS.edges) {
      const next = a === current ? b : b === current ? a : -1;
      if (next === -1 || prev[next] !== -1) continue;
      prev[next] = current;
      if (next === to) {
        const path = [to];
        let at = to;
        while (at !== from) { at = prev[at]; path.unshift(at); }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

export function createBots(scene, world, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = SIGHT_RANGE;
  const colliders = world.colliders;
  const shootables = world.shootables;
  const probe = new THREE.Box3();
  const tmp = new THREE.Vector3();
  const aimPoint = new THREE.Vector3();
  const eyePos = new THREE.Vector3();

  function overlaps(x, z, height = HEIGHT) {
    probe.min.set(x - RADIUS, 0.04, z - RADIUS);
    probe.max.set(x + RADIUS, height - 0.04, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function makeBot(team, name, spawn, index) {
    const teamColor = team === 'vanguard' ? PALETTE.vanguard : PALETTE.raven;
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.6, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242a'), roughness: 0.8 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), bodyMat);
    head.position.y = 1.55;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.05),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4 }));
    visor.position.set(0, 1.57, -0.14);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), darkMat);
    legL.position.set(-0.14, 0.31, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.5), darkMat);
    gun.position.set(0.2, 1.05, -0.3);
    group.add(torso, head, visor, legL, legR, gun);
    group.traverse((mesh) => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
    group.position.copy(spawn);
    scene.add(group);

    const bot = {
      team, name, group, torso, head,
      position: spawn.clone(),
      yaw: team === 'vanguard' ? 0 : Math.PI,
      health: HEALTH, armor: false, alive: true,
      weapon: index % 3 === 2 ? WEAPON_DEFS.smg : WEAPON_DEFS.rifle,
      state: 'idle', path: [], pathIndex: 0, holdNode: -1,
      target: null, targetPos: new THREE.Vector3(), reactAt: 0, lastSeenAt: -10,
      perceiveAt: 0, burstLeft: 0, fireAt: 0, pauseUntil: 0,
      strafeDir: 1, strafeAt: 0, plantAt: 0, defuseAt: 0,
      carrier: false, fighting: false, skill: 0.75 + Math.random() * 0.5,
      speed: 3.6 + Math.random() * 0.8,
      fall: 0,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    return bot;
  }

  const bots = [];
  let currentSite = 'A';
  const vanguardSpawns = [1, 2, 3, 4];
  const ravenSpawns = [28, 27, 29, 27, 28];
  const spawnPos = (team, i) => {
    const s = team === 'vanguard'
      ? new THREE.Vector3(-3 + i * 1.6, 0, 16.5)
      : new THREE.Vector3(-4 + i * 2, 0, -16.5);
    return s;
  };
  for (let i = 0; i < 4; i += 1) bots.push(makeBot('vanguard', VANGUARD_NAMES[i], spawnPos('vanguard', i), i));
  for (let i = 0; i < 5; i += 1) bots.push(makeBot('raven', RAVEN_NAMES[i], spawnPos('raven', i), i));
  const hitMeshes = [];
  for (const bot of bots) hitMeshes.push(bot.torso, bot.head);
  const allTargets = shootables.concat(hitMeshes);
  const playerPoint = new THREE.Vector3();
  const playerPoint2 = new THREE.Vector3();

  function resetRound(round, random) {
    const site = random() < 0.5 ? 'A' : 'B';
    currentSite = site;
    const siteNode = site === 'A' ? 21 : 22;
    const siteBack = site === 'A' ? 23 : 24;
    const siteCorner = site === 'A' ? 25 : 26;
    for (const bot of bots) {
      bot.health = HEALTH;
      bot.armor = round >= 3 && random() < 0.5;
      bot.alive = true;
      bot.fall = 0;
      bot.group.rotation.set(0, 0, 0);
      bot.group.position.copy(bot.position);
      bot.target = null;
      bot.burstLeft = 0;
      bot.plantAt = 0;
      bot.defuseAt = 0;
      bot.carrier = false;
      bot.fighting = false;
      if (bot.team === 'vanguard') {
        bot.position.copy(spawnPos('vanguard', VANGUARD_NAMES.indexOf(bot.name)));
        bot.yaw = 0;
        bot.state = 'toSite';
        bot.holdNode = -1;
        bot.path = [];
        bot.pathIndex = 0;
      } else {
        bot.position.copy(spawnPos('raven', RAVEN_NAMES.indexOf(bot.name)));
        bot.yaw = Math.PI;
        bot.state = 'hold';
        const holdIndex = RAVEN_NAMES.indexOf(bot.name);
        bot.holdNode = RAVEN_HOLDS[holdIndex];
        bot.path = findPath(nearestNode(bot.position.x, bot.position.z), bot.holdNode);
        bot.pathIndex = 0;
      }
    }
    // One Vanguard carries the spike; the rest follow to the chosen site.
    const carrier = bots[0];
    carrier.carrier = true;
    for (const bot of bots) {
      if (bot.team !== 'vanguard') continue;
      const dest = bot.carrier ? siteNode : (Math.random() < 0.5 ? siteNode : (Math.random() < 0.5 ? siteBack : siteCorner));
      bot.path = findPath(nearestNode(bot.position.x, bot.position.z), dest);
      bot.pathIndex = 0;
      bot.holdNode = dest;
    }
    hooks.onRoundPlan(site);
  }

  function moveToward(bot, x, z, dt, speed) {
    const dx = x - bot.position.x;
    const dz = z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true;
    const step = Math.min(dist, speed * dt);
    const nx = bot.position.x + (dx / dist) * step;
    const nz = bot.position.z + (dz / dist) * step;
    if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
    if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
    bot.yaw = Math.atan2(dx, dz) + Math.PI;
    return dist - step < 0.15;
  }

  function followPath(bot, dt) {
    if (bot.pathIndex >= bot.path.length) return true;
    const node = WAYPOINTS.nodes[bot.path[bot.pathIndex]];
    if (moveToward(bot, node[0], node[1], dt, bot.speed)) bot.pathIndex += 1;
    return bot.pathIndex >= bot.path.length;
  }

  function lookAt(bot, point, dt) {
    const dx = point.x - bot.position.x;
    const dz = point.z - bot.position.z;
    const want = Math.atan2(dx, dz) + Math.PI;
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += diff * Math.min(1, dt * 10);
  }

  // Returns the enemy bot or 'player' if visible from eye, else null. The
  // player has no hit mesh, so seeing the player means the ray reaches the
  // player's distance without hitting anything first.
  function perceive(bot, ctx, now) {
    const enemies = [];
    // The player is Vanguard: only Raven bots see the player as an enemy.
    // (Vanguard bots previously opened every round by shooting their own
    // teammate at spawn.)
    if (ctx.playerAlive && bot.team === 'raven') enemies.push({ kind: 'player', pos: ctx.playerPos, crouch: ctx.playerCrouch });
    for (const other of bots) {
      if (other.team === bot.team || !other.alive) continue;
      enemies.push({ kind: 'bot', bot: other, pos: other.position, crouch: false });
    }
    let best = null;
    let bestD = SIGHT_RANGE;
    for (const enemy of enemies) {
      const ex = enemy.pos.x;
      const ez = enemy.pos.z;
      const dx = ex - bot.position.x;
      const dz = ez - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > SIGHT_RANGE) continue;
      const eyeY = enemy.kind === 'player' ? (enemy.crouch ? 0.85 : 1.25) : 1.1;
      eyePos.set(bot.position.x, EYE, bot.position.z);
      aimPoint.set(ex, eyeY, ez);
      tmp.copy(aimPoint).sub(eyePos).normalize();
      raycaster.set(eyePos, tmp);
      raycaster.far = dist + 0.5;
      const hits = raycaster.intersectObjects(allTargets, false);
      let visible = false;
      if (enemy.kind === 'player') visible = hits.length === 0;
      else if (hits.length) visible = hits[0].object.userData.bot === enemy.bot;
      if (!visible) continue;
      if (dist < bestD) { bestD = dist; best = { enemy, dist }; }
    }
    return best;
  }

  // One bot shot: an errored ray from the bot's eye. It can hit an enemy bot
  // mesh, a wall, or the player, whose body is tested as a capsule against
  // the ray because the player has no hit mesh.
  function fireAt(bot, ctx, now) {
    const enemy = bot.target.enemy;
    const targetPos = enemy.kind === 'player' ? ctx.playerPos : enemy.bot.position;
    const headAim = Math.random() < 0.25;
    const chestY = enemy.kind === 'player' ? (ctx.playerCrouch ? 0.85 : 1.25) : 1.1;
    const aimY = headAim ? chestY + 0.45 : chestY;
    aimPoint.set(targetPos.x, aimY, targetPos.z);
    const dist = bot.position.distanceTo(aimPoint);
    const targetSpeed = enemy.kind === 'player' ? ctx.playerSpeed : enemy.bot.speed;
    const error = (0.012 + dist * 0.0011 + targetSpeed * 0.004) / bot.skill;
    eyePos.set(bot.position.x, EYE, bot.position.z);
    tmp.copy(aimPoint).sub(eyePos).normalize();
    tmp.x += (Math.random() * 2 - 1) * error;
    tmp.y += (Math.random() * 2 - 1) * error;
    tmp.z += (Math.random() * 2 - 1) * error;
    tmp.normalize();
    raycaster.set(eyePos, tmp);
    raycaster.far = 90;
    const hits = raycaster.intersectObjects(allTargets, false);
    const from = eyePos.clone();
    const firstDist = hits.length ? hits[0].distance : 90;
    let end = null;
    let impact = null;
    if (hits.length) {
      end = hits[0].point.clone();
      impact = hits[0].point;
    }
    // Player capsule test: head sphere then torso sphere, only if the ray
    // reaches the player before anything solid stops it.
    if (ctx.playerAlive && enemy.kind === 'player') {
      const chest = playerPoint.set(targetPos.x, chestY, targetPos.z);
      const tChest = chest.clone().sub(eyePos).dot(tmp);
      const head = playerPoint2.set(targetPos.x, chestY + 0.45, targetPos.z);
      const tHead = head.clone().sub(eyePos).dot(tmp);
      let playerHit = null;
      if (tHead > 0 && tHead < firstDist) {
        const closest = eyePos.clone().addScaledVector(tmp, tHead);
        if (closest.distanceTo(head) < 0.3) playerHit = { part: 'head', t: tHead, point: closest };
      }
      if (!playerHit && tChest > 0 && tChest < firstDist) {
        const closest = eyePos.clone().addScaledVector(tmp, tChest);
        if (closest.distanceTo(chest) < 0.5) playerHit = { part: 'torso', t: tChest, point: closest };
      }
      if (playerHit) {
        end = playerHit.point;
        impact = null;
        const damage = bot.weapon.damage * (playerHit.part === 'head' ? 3 : 1) * (ctx.playerArmor ? 0.5 : 1);
        hooks.onPlayerHit(damage, bot, playerHit.part === 'head');
      }
    } else if (hits.length) {
      const hitBot = hits[0].object.userData.bot;
      if (hitBot && hitBot.team !== bot.team) {
        const damage = bot.weapon.damage * (hits[0].object.userData.part === 'head' ? 3 : 1) * (hitBot.armor ? 0.5 : 1);
        hooks.onBotHit(hitBot, damage, hits[0].object.userData.part === 'head', bot);
      }
    }
    if (!end) end = eyePos.clone().addScaledVector(tmp, 60);
    hooks.onShot(bot, from, end, impact);
  }

  // Where this bot is trying to get to while it fights: attackers push the
  // target site, defenders fall back to the post they hold (or to the
  // planted site once the spike is down).
  function objectivePos(bot, ctx) {
    if (ctx.spikePlanted) return SITES[ctx.plantedSite].center;
    if (bot.team === 'vanguard') return SITES[ctx.targetSite].center;
    const node = WAYPOINTS.nodes[bot.holdNode];
    return node ? { x: node[0], z: node[1] } : SITES[ctx.targetSite].center;
  }

  // After a fight the bot may be far off its old path; re-plan from where
  // it stands instead of backtracking to a stale waypoint.
  function repathToObjective(bot, ctx) {
    let dest;
    if (ctx.spikePlanted) dest = ctx.plantedSite === 'A' ? 21 : 22;
    else if (bot.team === 'vanguard') dest = ctx.targetSite === 'A' ? 21 : 22;
    else dest = bot.holdNode;
    if (dest < 0) return;
    bot.path = findPath(nearestNode(bot.position.x, bot.position.z), dest);
    bot.pathIndex = 0;
  }

  function stepBot(bot, dt, ctx, now) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    if (ctx.phase === 'buy' || ctx.phase === 'end' || ctx.phase === 'roundEnd' || ctx.phase === 'matchEnd') {
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    // Perception, throttled. A bot on the move to an objective ignores a
    // distant target and keeps walking; a bot holding a position engages at
    // full sight range. Without this, both teams stop at spawn and trade
    // pot-shots down the mid lane instead of playing the objective.
    if (now >= bot.perceiveAt) {
      bot.perceiveAt = now + PERCEIVE_EVERY;
      const seen = perceive(bot, ctx, now);
      const moving = bot.pathIndex < bot.path.length;
      if (seen && moving && seen.dist > ENGAGE_MOVE_RANGE) {
        if (bot.target && now - bot.lastSeenAt > 2) bot.target = null;
      } else if (seen) {
        if (!bot.target) bot.reactAt = now + (0.35 + Math.random() * 0.45) / bot.skill;
        bot.target = seen;
        bot.lastSeenAt = now;
      } else if (bot.target && now - bot.lastSeenAt > 2) {
        bot.target = null;
      }
    }

    // A bot mid-plant or mid-defuse does not abandon the work for a distant
    // enemy it merely sees: the work is interrupted only by a bullet landing
    // (damage()) or by the enemy closing in. Otherwise a defender rotating
    // back 20 m away cancels every plant just by being seen.
    let fighting = bot.target && now >= bot.reactAt;
    if (fighting && (bot.state === 'plant' || bot.state === 'defuse')) {
      const enemy = bot.target.enemy;
      const targetPos = enemy.kind === 'player' ? ctx.playerPos : enemy.bot.position;
      if (bot.position.distanceTo(targetPos) > 8) fighting = false;
    }
    if (!fighting && bot.fighting) repathToObjective(bot, ctx);
    bot.fighting = fighting;
    if (fighting) {
      // Taking fire interrupts a plant or a defuse.
      bot.plantAt = 0;
      bot.defuseAt = 0;
      if (bot.state === 'plant' || bot.state === 'defuse') bot.state = 'toSite';
      const enemy = bot.target.enemy;
      const targetPos = enemy.kind === 'player' ? ctx.playerPos : enemy.bot.position;
      lookAt(bot, targetPos, dt);
      const dist = bot.position.distanceTo(targetPos);
      if (dist > 8) {
        // Push the objective while firing, not the enemy: a standing
        // firefight at 20 m never ends, and the attackers never reach the
        // site. Shots still track the enemy (fireAt aims by position), so
        // the bot advances, shoots, and faces its target.
        const obj = objectivePos(bot, ctx);
        moveToward(bot, obj.x, obj.z, dt, bot.speed * 0.7);
        lookAt(bot, targetPos, dt);
      } else {
        if (now >= bot.strafeAt) {
          bot.strafeAt = now + 0.6 + Math.random() * 0.6;
          bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
        }
        const sideX = Math.cos(bot.yaw) * bot.strafeDir;
        const sideZ = -Math.sin(bot.yaw) * bot.strafeDir;
        const nx = bot.position.x + sideX * 1.6 * dt;
        const nz = bot.position.z + sideZ * 1.6 * dt;
        if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
        if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
      }
      if (now >= bot.fireAt && now >= bot.pauseUntil) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = bot.weapon.burst;
          bot.pauseUntil = now + 0.5 + Math.random() * 0.4;
        }
        if (bot.burstLeft > 0) {
          bot.burstLeft -= 1;
          bot.fireAt = now + bot.weapon.gap;
          fireAt(bot, ctx, now);
        }
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;
      return;
    }

    // Not fighting: follow the objective.
    if (ctx.spikePlanted) {
      if (bot.team === 'raven') {
        if (bot.state !== 'defuse' && bot.state !== 'toDefuse') {
          bot.state = 'toDefuse';
          bot.path = findPath(nearestNode(bot.position.x, bot.position.z), ctx.plantedSite === 'A' ? 21 : 22);
          bot.pathIndex = 0;
        }
        if (bot.state === 'toDefuse' && followPath(bot, dt)) {
          bot.state = 'defuse';
          bot.defuseAt = now;
        }
        if (bot.state === 'defuse') {
          lookAt(bot, SITES[ctx.plantedSite].center, dt);
          hooks.onDefuseProgress(bot, Math.min(1, (now - bot.defuseAt) / DEFUSE_TIME));
          if (now - bot.defuseAt >= DEFUSE_TIME) {
            bot.state = 'idle';
            bot.defuseAt = 0;
            hooks.onDefused(bot);
          }
        }
      } else {
        if (bot.state !== 'holdSite') {
          bot.state = 'holdSite';
          const node = ctx.plantedSite === 'A' ? (Math.random() < 0.5 ? 23 : 25) : (Math.random() < 0.5 ? 24 : 26);
          bot.path = findPath(nearestNode(bot.position.x, bot.position.z), node);
          bot.pathIndex = 0;
        }
        if (followPath(bot, dt)) {
          bot.yaw += Math.sin(now * 0.7 + bot.position.x) * dt * 0.4;
        }
      }
    } else if (bot.team === 'vanguard') {
      if (followPath(bot, dt)) {
        // Plant only while standing on the target site, never after wandering
        // off to investigate a sound.
        if (bot.carrier && bot.position.distanceTo(SITES[ctx.targetSite].center) < SITES[ctx.targetSite].radius) {
          bot.state = 'plant';
          if (bot.plantAt === 0) bot.plantAt = now;
          lookAt(bot, SITES[ctx.targetSite].center, dt);
          hooks.onPlantProgress(bot, Math.min(1, (now - bot.plantAt) / PLANT_TIME));
          if (now - bot.plantAt >= PLANT_TIME) {
            bot.plantAt = 0;
            bot.state = 'holdSite';
            hooks.onPlanted(bot, ctx.targetSite);
          }
        } else {
          bot.yaw += Math.sin(now * 0.7 + bot.position.x) * dt * 0.4;
        }
      }
    } else {
      // Raven (defenders): walk to the hold post, or return to it after
      // investigating a sound.
      if (bot.state === 'investigate') {
        if (followPath(bot, dt)) {
          bot.state = 'hold';
          bot.path = findPath(nearestNode(bot.position.x, bot.position.z), bot.holdNode);
          bot.pathIndex = 0;
        }
      } else if (followPath(bot, dt)) {
        bot.yaw += Math.sin(now * 0.6 + bot.position.z) * dt * 0.5;
      }
    }
    bot.group.position.copy(bot.position);
    bot.group.rotation.y = bot.yaw;
  }

  return {
    bots,
    hitMeshes,
    resetRound,
    damage(bot, amount, part) {
      if (!bot.alive) return false;
      bot.health -= amount;
      if (bot.health > 0) {
        // A bullet landing interrupts a plant or a defuse, even a
        // non-lethal one.
        if (bot.state === 'plant') { bot.plantAt = 0; bot.state = 'toSite'; }
        if (bot.state === 'defuse') { bot.defuseAt = 0; bot.state = 'toDefuse'; }
        return false;
      }
      bot.alive = false;
      bot.fall = 0;
      bot.target = null;
      hooks.onBotKilled(bot);
      // The spike drops: the nearest living Vanguard picks it up and carries
      // on to the site, so one death never stalls the round.
      if (bot.team === 'vanguard' && bot.carrier) {
        bot.carrier = false;
        let best = null;
        let bestD = Infinity;
        for (const other of bots) {
          if (other.team !== 'vanguard' || !other.alive) continue;
          const d = other.position.distanceToSquared(bot.position);
          if (d < bestD) { bestD = d; best = other; }
        }
        if (best) {
          best.carrier = true;
          best.state = 'toSite';
          best.holdNode = currentSite === 'A' ? 21 : 22;
          best.path = findPath(nearestNode(best.position.x, best.position.z), best.holdNode);
          best.pathIndex = 0;
        }
      }
      return true;
    },
    hearShot(position) {
      // Only defenders holding a post rotate toward a sound; attackers keep
      // pushing the site, or every shot drags the whole round off course.
      for (const bot of bots) {
        if (!bot.alive || bot.target || bot.team !== 'raven' || bot.state !== 'hold') continue;
        const d = bot.position.distanceTo(position);
        // Only nearby holders rotate: at 25 m every shot pulled the far
        // site's defenders across the map too, so the attackers always
        // faced all five defenders at once.
        if (d < 16) {
          const node = nearestNode(position.x, position.z);
          bot.path = findPath(nearestNode(bot.position.x, bot.position.z), node);
          bot.pathIndex = 0;
          bot.state = 'investigate';
        }
      }
    },
    step(dt, ctx, now) {
      for (const bot of bots) stepBot(bot, dt, ctx, now);
    },
  };
}
