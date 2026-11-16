// Transient 3D feedback: tracers, impact sparks and the spike explosion. Every
// mesh is preallocated in a pool and reused, so the hot loop makes no objects.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 24;
const SPARKS = 60;
const TRACER_LIFE = 0.09;
const SPARK_LIFE = 0.35;

export function createEffects(scene) {
  const tracerMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), tracerMat);
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerCursor = 0;

  const sparkMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.ink), transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const sparks = [];
  for (let i = 0; i < SPARKS; i += 1) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), sparkMat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, velocity: new THREE.Vector3() });
  }
  let sparkCursor = 0;

  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 30);
  scene.add(blastLight);
  let blastLife = 0;

  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const mid = new THREE.Vector3();

  return {
    tracer(start, end) {
      const item = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % TRACERS;
      from.copy(start);
      to.copy(end);
      const length = from.distanceTo(to);
      if (length < 0.5) return;
      mid.addVectors(from, to).multiplyScalar(0.5);
      item.mesh.position.copy(mid);
      item.mesh.lookAt(to);
      item.mesh.scale.set(1, 1, length);
      item.mesh.visible = true;
      item.life = TRACER_LIFE;
    },
    impact(point) {
      for (let i = 0; i < 6; i += 1) {
        const item = sparks[sparkCursor];
        sparkCursor = (sparkCursor + 1) % SPARKS;
        item.mesh.position.copy(point);
        item.velocity.set((Math.random() - 0.5) * 6, Math.random() * 4 + 1, (Math.random() - 0.5) * 6);
        item.mesh.visible = true;
        item.life = SPARK_LIFE * (0.6 + Math.random() * 0.4);
      }
    },
    explosion(point) {
      blast.position.copy(point).setY(point.y + 0.4);
      blast.visible = true;
      blastLife = 0.6;
      blastLight.position.copy(point).setY(point.y + 1);
    },
    step(dt) {
      for (const item of tracers) {
        if (item.life <= 0) continue;
        item.life -= dt;
        if (item.life <= 0) item.mesh.visible = false;
      }
      for (const item of sparks) {
        if (item.life <= 0) continue;
        item.life -= dt;
        item.mesh.position.addScaledVector(item.velocity, dt);
        item.velocity.y -= 12 * dt;
        if (item.life <= 0) item.mesh.visible = false;
      }
      if (blastLife > 0) {
        blastLife -= dt;
        const t = 1 - Math.max(0, blastLife) / 0.6;
        const scale = 1 + t * 8;
        blast.scale.setScalar(scale);
        blast.material.opacity = Math.max(0, 0.55 * (1 - t));
        blastLight.intensity = Math.max(0, 60 * (1 - t));
        if (blastLife <= 0) {
          blast.visible = false;
          blastLight.intensity = 0;
        }
      }
    },
  };
}
