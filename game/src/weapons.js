// The arsenal: four original weapons and a frag grenade. Each entry owns its
// numbers (damage, fire rate, spread, recoil, price) and builds its own view
// model from boxes. main.js owns the ray and the damage; match.js owns the
// money. Accuracy pays: spread grows with movement and with sustained fire,
// and headshots multiply damage.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, slot: 1,
    mag: 12, reserve: 48, fireGap: 0.16, reloadTime: 1.4,
    damage: 28, headMult: 3, spreadStill: 0.003, spreadMove: 0.02,
    recoil: 0.007, auto: false, range: 60,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', price: 1200, slot: 2,
    mag: 28, reserve: 112, fireGap: 0.075, reloadTime: 1.8,
    damage: 24, headMult: 3, spreadStill: 0.006, spreadMove: 0.032,
    recoil: 0.006, auto: true, range: 55,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longarm', price: 2700, slot: 3,
    mag: 30, reserve: 90, fireGap: 0.096, reloadTime: 1.9,
    damage: 34, headMult: 4, spreadStill: 0.0022, spreadMove: 0.028,
    recoil: 0.009, auto: true, range: 80,
  },
  sniper: {
    id: 'sniper', name: 'LS-50 Longshot', price: 4750, slot: 4,
    mag: 5, reserve: 20, fireGap: 1.1, reloadTime: 2.6,
    damage: 95, headMult: 4, spreadStill: 0.0004, spreadMove: 0.06,
    recoil: 0.045, auto: false, range: 90, scope: true,
  },
};

export const GRENADE = { price: 300, max: 2, fuse: 1.6, radius: 7, damage: 110 };

const MUZZLE_TIME = 0.06;

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.1 });
  const model = new THREE.Group();
  function part(w, h, d, x, y, z, mat = body) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  }
  if (def.id === 'pistol') {
    part(0.06, 0.09, 0.24, 0, 0, -0.1, grip);
    part(0.05, 0.12, 0.07, 0, -0.08, 0.03, grip);
    part(0.02, 0.02, 0.02, 0, 0.055, -0.2, accent);
  } else if (def.id === 'smg') {
    part(0.08, 0.09, 0.34, 0, 0, -0.05);
    part(0.04, 0.04, 0.3, 0, 0.02, -0.32, grip);
    part(0.05, 0.14, 0.06, 0, -0.09, 0.02, grip);
    part(0.07, 0.03, 0.1, 0, 0.06, -0.05, accent);
  } else if (def.id === 'sniper') {
    part(0.08, 0.1, 0.5, 0, 0, -0.1);
    part(0.035, 0.035, 0.55, 0, 0.03, -0.5, grip);
    part(0.06, 0.06, 0.14, 0, 0.09, -0.08, accent);
    part(0.07, 0.08, 0.2, 0, -0.02, 0.28, grip);
  } else {
    part(0.09, 0.1, 0.42, 0, 0, -0.05);
    part(0.045, 0.045, 0.4, 0, 0.025, -0.43, grip);
    part(0.075, 0.08, 0.22, 0, -0.02, 0.25, grip);
    part(0.05, 0.03, 0.08, 0, 0.065, -0.12, accent);
  }
  model.position.set(0.26, -0.23, -0.5);
  model.rotation.y = -0.08;
  model.scale.setScalar(0.85);
  return model;
}

export function createWeaponSet(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  // Two crossed planes read as a muzzle flash instead of a flat card.
  const flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const flash = new THREE.Group();
  const flashA = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
  flashA.rotation.z = Math.PI / 4;
  const flashB = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
  flashB.rotation.z = -Math.PI / 4;
  flash.add(flashA, flashB);
  flash.position.set(0.26, -0.2, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.26, -0.18, -0.6);
  camera.add(flashLight);

  let current = WEAPONS.pistol;
  const state = {
    id: 'pistol', mag: current.mag, reserve: current.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0,
    grenades: 0, scoped: false,
  };

  function applyWeapon(def) {
    for (const [id, model] of Object.entries(models)) model.visible = id === def.id;
    current = def;
    state.id = def.id;
    state.mag = def.mag;
    state.reserve = def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.bloom = 0;
    state.scoped = false;
  }
  applyWeapon(WEAPONS.pistol);

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.35);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.id];
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flashLight.intensity = state.flash > 0 ? 10 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (current.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = current.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    def() { return current; },
    owned: new Set(['pistol']),
    equip(id) {
      if (!WEAPONS[id]) return false;
      applyWeapon(WEAPONS[id]);
      return true;
    },
    // Buying keeps the owned set; the caller charges the money.
    buy(id) {
      if (!WEAPONS[id] || id === 'pistol') return false;
      this.owned.add(id);
      applyWeapon(WEAPONS[id]);
      return true;
    },
    resetRound() {
      // Weapons are kept between rounds; ammunition is topped up.
      state.mag = current.mag;
      state.reserve = current.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      state.scoped = false;
    },
    resetMatch() {
      this.owned = new Set(['pistol']);
      state.grenades = 0;
      applyWeapon(WEAPONS.pistol);
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = current.fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055 + (current.id === 'sniper' ? 0.05 : 0);
      state.bloom = Math.min(0.05, state.bloom + (current.id === 'sniper' ? 0.05 : 0.012));
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === current.mag || state.reserve === 0) return false;
      state.reloadLeft = current.reloadTime;
      return true;
    },
    spread(speed, moving) {
      const move = Math.min(1, speed / 5.2);
      const base = current.spreadStill + move * current.spreadMove;
      return base + state.bloom + (moving ? 0.004 : 0);
    },
    addGrenade() {
      if (state.grenades >= GRENADE.max) return false;
      state.grenades += 1;
      return true;
    },
    throwGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      return true;
    },
  };
}
