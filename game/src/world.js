// The map: "Yard 7", an original industrial yard, 48 x 40 m. Two spike sites
// (A west, B east) past a mid wall with one open door, long lanes down each flank,
// and crates, tanks and wall stubs for cover. Every solid is a collider for
// movement and a surface a bullet stops on. Plain geometry only, no models,
// no textures, no network. The waypoint graph at the bottom is what the bots
// walk: nodes are open ground, edges are straight walkable lines between them.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { center: new THREE.Vector3(-17, 0, -11), radius: 4.2 },
  B: { center: new THREE.Vector3(17, 0, -11), radius: 4.2 },
};

export const SPAWNS = {
  vanguard: [
    new THREE.Vector3(-3, 0, 16.5),
    new THREE.Vector3(0, 0, 17.5),
    new THREE.Vector3(3, 0, 16.5),
    new THREE.Vector3(-6, 0, 15),
    new THREE.Vector3(6, 0, 15),
  ],
  raven: [
    new THREE.Vector3(-3, 0, -16.5),
    new THREE.Vector3(0, 0, -17.5),
    new THREE.Vector3(3, 0, -16.5),
    new THREE.Vector3(-6, 0, -15),
    new THREE.Vector3(6, 0, -15),
  ],
};

// Waypoint graph: [x, z] nodes and [a, b] edges. Bots path over it with BFS.
// Every edge is a straight walkable line: no wall, crate or tank crosses it.
export const WAYPOINTS = {
  nodes: [
    [0, 16], [-4, 15], [4, 15],           // 0-2 vanguard spawn
    [-12, 10], [12, 10], [0, 9],          // 3-5 south yard
    [-12, 4], [12, 4], [0, 4],            // 6-8 mid south
    [-14, 2], [14, 2], [-20, 5], [20, 5], // 9-12 long lanes
    [0, -1], [-5, -1], [5, -1],           // 13-15 mid door
    [-10, -5], [10, -5], [0, -6],         // 16-18 north mid
    [-14, -6.5], [14, -6.5],              // 19-20 site approach
    [-17, -11], [17, -11],                // 21-22 sites
    [-20, -13], [20, -10],                // 23-24 site backs
    [-12.5, -12], [12.5, -12],            // 25-26 site corners
    [0, -16], [-4, -15], [4, -15],        // 27-29 raven spawn
    [-20, -4], [20, -4],                  // 30-31 long north
    [-8, -9], [8, -9],                    // 32-33 north pockets
  ],
  edges: [
    [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [5, 8],
    [3, 6], [4, 7], [6, 9], [7, 10],
    [9, 11], [10, 12], [30, 32], [31, 33],
    [8, 13], [13, 14], [13, 15], [14, 16], [15, 17], [13, 18],
    [16, 19], [17, 20], [18, 32], [18, 33], [19, 21], [20, 22],
    [21, 23], [22, 24], [21, 25], [22, 26], [19, 25], [20, 26],
    [23, 25], [24, 26], [16, 32], [17, 33], [32, 27], [33, 27],
    [27, 28], [27, 29], [28, 32], [29, 33], [14, 32], [15, 33],
    [30, 19], [31, 20], [3, 9], [4, 10],
  ],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const siteMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), roughness: 0.6, metalness: 0.05,
    emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.25,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d0f12'), roughness: 0.95 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radius, height, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 20), materials[material]);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromCenterAndSize(
      new THREE.Vector3(x, height / 2, z), new THREE.Vector3(radius * 1.7, height, radius * 1.7)));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter, 48 x 40 m, 5 m walls, open to the sky.
  box(48.4, 0.4, 40.4, 0, -0.2, 0, 'surface');
  box(0.4, 5, 40.4, -24.2, 2.5, 0, 'surface');
  box(0.4, 5, 40.4, 24.2, 2.5, 0, 'surface');
  box(48.4, 5, 0.4, 0, 2.5, -20.2, 'surface');
  box(48.4, 5, 0.4, 0, 2.5, 20.2, 'surface');

  // Mid wall with one open door (x -8..8): the choke point between the halves.
  box(16, 5, 0.6, -16, 2.5, -2, 'surface');
  box(16, 5, 0.6, 16, 2.5, -2, 'surface');
  // Flank walls that split the south yard into three lanes.
  box(0.6, 5, 12, -8, 2.5, 6, 'surface');
  box(0.6, 5, 12, 8, 2.5, 6, 'surface');
  // North pockets are open ground; cover there is the crates below, not walls.
  // Site A warehouse shell: two walls, open to the east.
  box(0.6, 4, 9, -21.5, 2, -11, 'surface');
  box(8, 4, 0.6, -17.5, 2, -15.5, 'surface');
  // Site B silo yard: three tanks.
  cylinder(1.7, 5.2, 20.5, -14, 'hairline');
  cylinder(1.4, 4.2, 16.5, -16.5, 'surface');
  cylinder(1.4, 4.2, 21.5, -8.5, 'surface');

  // Cover crates: 1.1 m to crouch behind, 2.2 m to stand behind.
  const crates = [
    [2.2, 1.1, 1.4, 2.5, -5.5], [-2.6, 1.1, 1.4, -3.5, 2], [2.6, 1.1, 1.4, 3.5, 2],
    [2.2, 1.1, 1.4, -2.5, 8.5], [2.2, 1.1, 1.4, -18, 2], [2.2, 1.1, 1.4, 18, 2],
    [2.2, 1.1, 1.4, -8, 16.5], [2.2, 1.1, 1.4, 8, 16.5],
    [1.4, 2.2, 1.4, -11.5, -9.5], [1.4, 2.2, 1.4, 11.5, -9.5],
    [2.2, 1.1, 1.4, -13, -13.5], [2.2, 1.1, 1.4, 13, -13.5],
    [2.2, 1.1, 1.4, -15, -14], [2.2, 1.1, 1.4, 15, -14],
  ];
  for (const [w, h, d, x, z] of crates) box(w, h, d, x, h / 2, z, 'hairline');

  // Barrels scattered as low cover.
  cylinder(0.55, 1.1, -10, 13.5, 'muted');
  cylinder(0.55, 1.1, 10, 13.5, 'muted');
  cylinder(0.55, 1.1, -2, -12, 'muted');
  cylinder(0.55, 1.1, 2, -12, 'muted');

  // Site markers: a glowing floor plate and a sign post at each site.
  for (const site of Object.values(SITES)) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(7, 0.06, 7), siteMat);
    plate.position.set(site.center.x, 0.03, site.center.z);
    plate.receiveShadow = true;
    group.add(plate);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.4, 0.18), materials.hairline);
    post.position.set(site.center.x, 1.7, site.center.z + 3.2);
    post.castShadow = true;
    group.add(post);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.08), siteMat);
    sign.position.set(site.center.x, 3.1, site.center.z + 3.2);
    group.add(sign);
    colliders.push(new THREE.Box3().setFromObject(post));
    shootables.push(post);
  }

  // Floodlight poles with warm lamps.
  for (const [x, z] of [[-22, 18], [22, 18], [-22, -18], [22, -18]]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.22, 6.5, 0.22), darkMat);
    pole.position.set(x, 3.25, z);
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), emissive: new THREE.Color(PALETTE.ink), emissiveIntensity: 0.9 }));
    lamp.position.set(x, 6.6, z);
    group.add(lamp);
  }

  // Light: a warm key from the front right, a cool fill from behind, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.9);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.9);
  key.position.set(14, 18, 10);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 1.0);
  fill.position.set(-12, 10, 14);
  scene.add(fill);

  return { colliders, shootables, group };
}
