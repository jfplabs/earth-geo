/**
 * Earth Geo — Main Application
 * Google Earth-quality 3D globe with satellite imagery
 */

import * as THREE from 'three';
import { Globe, getSunDirection } from './components/globe.js';
import { TileManager } from './components/tileManager.js';
import { MarkerManager } from './components/markers.js';
import { sampleFlights } from './components/sampleData.js';
import { UIController } from './components/ui.js';

// ---- App State ----
const state = {
  flights: [...sampleFlights],
  selectedFlight: null,
  isRotating: true,
  mouse: new THREE.Vector2(),
  raycaster: new THREE.Raycaster(),
};

// ---- Three.js Setup ----
const canvas = document.getElementById('globe-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.001, 100);
camera.position.set(0, 0, 3.5);

// ---- Lighting ----
const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
sunLight.position.set(5, 3, 5);
scene.add(sunLight);

// ---- Stars ----
function createStars() {
  const geometry = new THREE.BufferGeometry();
  const count = 10000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 30 + Math.random() * 70;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.04, sizeAttenuation: true,
    transparent: true, opacity: 0.7,
  }));
}
scene.add(createStars());

// ---- Globe ----
const globe = new Globe(null);
const globeGroup = globe.getGroup();
scene.add(globeGroup);

// ---- Satellite Tile Manager ----
const tileManager = new TileManager(globeGroup, camera, renderer);

// ---- Markers ----
const markerManager = new MarkerManager(globeGroup, state.flights, camera);

// ---- UI ----
const ui = new UIController(state, markerManager);

// ===========================================================
// ORBIT CONTROLS
// ===========================================================
const GLOBE_RADIUS = 1.0;

const orbit = {
  spherical: new THREE.Spherical().setFromVector3(camera.position),
  target: new THREE.Vector3(0, 0, 0),

  minDistance: 1.005,
  maxDistance: 10.0,

  minPolarAngle: 0.05,
  maxPolarAngle: Math.PI - 0.05,

  isDragging: false,
  dampingFactor: 0.93,
  velocity: { theta: 0, phi: 0 },
  previousMouse: { x: 0, y: 0 },

  // Smooth zoom — target is where we want to be, camera lerps there
  targetRadius: 3.5,
  zoomLerp: 0.08,

  autoRotateSpeed: 0.0005,
  autoRotateTimeout: null,
};

orbit.targetRadius = orbit.spherical.radius;

function clampAndApply() {
  orbit.spherical.radius = THREE.MathUtils.clamp(orbit.spherical.radius, orbit.minDistance, orbit.maxDistance);
  orbit.spherical.phi = THREE.MathUtils.clamp(orbit.spherical.phi, orbit.minPolarAngle, orbit.maxPolarAngle);
  camera.position.setFromSpherical(orbit.spherical);
  camera.position.add(orbit.target);
  camera.lookAt(orbit.target);
}

// ---- Rotation speed adapts to altitude ----
function getRotateSpeed() {
  const alt = orbit.spherical.radius - GLOBE_RADIUS;
  // Far (alt 5+): speed 0.003
  // Medium (alt 0.5): speed 0.003  
  // Close (alt 0.01): speed 0.001 — still very usable
  // Surface (alt 0.001): speed 0.0005 — fine control
  return 0.003 * Math.max(0.15, Math.min(1.0, Math.sqrt(alt) * 1.5));
}

// ---- Mouse: Drag to orbit ----
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  orbit.isDragging = true;
  state.isRotating = false;
  orbit.previousMouse = { x: e.clientX, y: e.clientY };
  orbit.velocity = { theta: 0, phi: 0 };
  clearTimeout(orbit.autoRotateTimeout);
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('mousemove', (e) => {
  state.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  state.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  if (orbit.isDragging) {
    const dx = e.clientX - orbit.previousMouse.x;
    const dy = e.clientY - orbit.previousMouse.y;
    const speed = getRotateSpeed();

    const dTheta = -dx * speed;
    const dPhi = -dy * speed;

    orbit.spherical.theta += dTheta;
    orbit.spherical.phi += dPhi;
    orbit.velocity.theta = dTheta;
    orbit.velocity.phi = dPhi;
    orbit.previousMouse = { x: e.clientX, y: e.clientY };
    clampAndApply();
  }

  // Hover
  state.raycaster.setFromCamera(state.mouse, camera);
  const intersects = state.raycaster.intersectObjects(markerManager.getMarkerMeshes());
  const tooltip = document.getElementById('tooltip');

  if (intersects.length > 0) {
    canvas.style.cursor = 'pointer';
    const cluster = markerManager.getClusterByMesh(intersects[0].object);
    const flight = markerManager.getFlightByMesh(intersects[0].object);

    if (cluster && cluster.isCluster) {
      const count = cluster.flights.length;
      const names = cluster.flights.slice(0, 3).map(f => f.title).join(', ');
      const more = count > 3 ? ` +${count - 3} more` : '';
      tooltip.classList.remove('hidden');
      document.getElementById('tooltip-text').textContent = `${count} flights: ${names}${more}`;
    } else if (flight) {
      tooltip.classList.remove('hidden');
      document.getElementById('tooltip-text').textContent = `${flight.title} — ${flight.location}`;
    }
    tooltip.style.left = (e.clientX + 16) + 'px';
    tooltip.style.top = (e.clientY - 16) + 'px';
  } else {
    if (!orbit.isDragging) canvas.style.cursor = 'grab';
    tooltip.classList.add('hidden');
  }
});

canvas.addEventListener('mouseup', () => {
  orbit.isDragging = false;
  canvas.style.cursor = 'grab';
  orbit.autoRotateTimeout = setTimeout(() => { state.isRotating = true; }, 5000);
});

// ---- Click / Double-click ----
canvas.addEventListener('click', (e) => {
  state.raycaster.setFromCamera(state.mouse, camera);
  const intersects = state.raycaster.intersectObjects(markerManager.getMarkerMeshes());
  if (intersects.length > 0) {
    const cluster = markerManager.getClusterByMesh(intersects[0].object);
    const flight = markerManager.getFlightByMesh(intersects[0].object);
    if (cluster && cluster.isCluster) {
      const center = cluster.center;
      const sp = new THREE.Spherical().setFromVector3(center);
      flyTo(sp.theta, sp.phi, orbit.spherical.radius * 0.4);
    } else if (flight) {
      ui.showInfoPanel(flight);
    }
  }
});

canvas.addEventListener('dblclick', (e) => {
  e.preventDefault();
  state.isRotating = false;
  clearTimeout(orbit.autoRotateTimeout);
  state.raycaster.setFromCamera(state.mouse, camera);
  const hits = state.raycaster.intersectObject(globe.getEarthMesh());
  if (hits.length > 0) {
    const pt = hits[0].point.normalize().multiplyScalar(orbit.spherical.radius);
    const sp = new THREE.Spherical().setFromVector3(pt);
    flyTo(sp.theta, sp.phi, Math.max(orbit.spherical.radius * 0.35, orbit.minDistance), 1000);
  }
});

function flyTo(theta, phi, radius, duration = 800) {
  const s = { theta: orbit.spherical.theta, phi: orbit.spherical.phi, radius: orbit.spherical.radius };
  const start = performance.now();
  state.isRotating = false;
  clearTimeout(orbit.autoRotateTimeout);

  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const e = 1 - Math.pow(1 - t, 3);
    orbit.spherical.theta = s.theta + (theta - s.theta) * e;
    orbit.spherical.phi = s.phi + (phi - s.phi) * e;
    orbit.spherical.radius = s.radius + (radius - s.radius) * e;
    orbit.targetRadius = orbit.spherical.radius;
    clampAndApply();
    if (t < 1) requestAnimationFrame(step);
    else {
      markerManager.needsRecluster = true;
      orbit.autoRotateTimeout = setTimeout(() => { state.isRotating = true; }, 5000);
    }
  }
  requestAnimationFrame(step);
}

// ===========================================================
// SCROLL ZOOM
// ===========================================================
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  state.isRotating = false;
  clearTimeout(orbit.autoRotateTimeout);

  // 20% per tick — fast enough to get from space to street in ~15 scrolls
  const dir = e.deltaY > 0 ? 1 : -1;
  orbit.targetRadius *= (1 + dir * 0.10);
  orbit.targetRadius = THREE.MathUtils.clamp(orbit.targetRadius, orbit.minDistance, orbit.maxDistance);

  orbit.autoRotateTimeout = setTimeout(() => { state.isRotating = true; }, 5000);
}, { passive: false });

// ---- Touch ----
let touches = { start: [], last: [], pinchDist: 0, pinchRadius: 0 };

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  state.isRotating = false;
  clearTimeout(orbit.autoRotateTimeout);
  touches.last = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
  if (e.touches.length === 2) {
    touches.pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    touches.pinchRadius = orbit.targetRadius;
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    const dx = e.touches[0].clientX - touches.last[0].x;
    const dy = e.touches[0].clientY - touches.last[0].y;
    const speed = getRotateSpeed();
    orbit.spherical.theta -= dx * speed;
    orbit.spherical.phi -= dy * speed;
    clampAndApply();
    touches.last = [{ x: e.touches[0].clientX, y: e.touches[0].clientY }];
  } else if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    orbit.targetRadius = THREE.MathUtils.clamp(touches.pinchRadius * (touches.pinchDist / d), orbit.minDistance, orbit.maxDistance);
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (e.touches.length === 0) {
    orbit.autoRotateTimeout = setTimeout(() => { state.isRotating = true; }, 5000);
  }
});

// ---- Resize ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Zoom Level Display ----
function getZoomLevelName(alt) {
  if (alt <= 0.005) return '🏙️ Street Level';
  if (alt <= 0.02) return '🏘️ Neighborhood';
  if (alt <= 0.1) return '🌆 City';
  if (alt <= 0.5) return '🗺️ Region';
  if (alt <= 2.0) return '🌍 Country';
  if (alt <= 5.0) return '🌏 Continent';
  return '🛸 Space';
}

// ===========================================================
// ANIMATION LOOP — lean and fast
// ===========================================================
let lastZoomDisplay = '';
let lastNearUpdate = 0;

function animate() {
  requestAnimationFrame(animate);

  // Auto-rotate
  if (state.isRotating && !orbit.isDragging) {
    orbit.spherical.theta += orbit.autoRotateSpeed;
    clampAndApply();
  }

  // Momentum
  if (!orbit.isDragging && !state.isRotating) {
    const vt = orbit.velocity.theta, vp = orbit.velocity.phi;
    if (Math.abs(vt) > 0.000005 || Math.abs(vp) > 0.000005) {
      orbit.velocity.theta *= orbit.dampingFactor;
      orbit.velocity.phi *= orbit.dampingFactor;
      orbit.spherical.theta += orbit.velocity.theta;
      orbit.spherical.phi += orbit.velocity.phi;
      clampAndApply();
    }
  }

  // Smooth zoom — lerp toward target
  const zDiff = orbit.targetRadius - orbit.spherical.radius;
  if (Math.abs(zDiff) > 0.0001) {
    orbit.spherical.radius += zDiff * orbit.zoomLerp;
    clampAndApply();
    markerManager.needsRecluster = true;
  }

  // Update near/far plane only when altitude changes significantly (not every frame)
  const altitude = orbit.spherical.radius - GLOBE_RADIUS;
  const now = performance.now();
  if (now - lastNearUpdate > 200) { // every 200ms max
    lastNearUpdate = now;
    const near = Math.max(0.0005, altitude * 0.05);
    const far = Math.max(50, orbit.spherical.radius * 20);
    if (Math.abs(camera.near - near) > 0.0001) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }

  // Globe
  globe.update(getSunDirection());

  // Opacity: base globe fades ONLY when tiles are actually loaded and visible
  // This prevents "losing the continent" — base stays until tiles cover the view
  tileManager.setVisible(true);
  const visibleTiles = tileManager.getVisibleTileCount();
  
  if (orbit.spherical.radius >= 3.0 || visibleTiles === 0) {
    // Far out OR no tiles loaded yet: keep base fully visible
    globe.setBaseOpacity(1.0);
  } else if (orbit.spherical.radius <= 1.5 && visibleTiles >= 4) {
    // Very close AND tiles are covering the view: base can go transparent
    globe.setBaseOpacity(0.0);
  } else if (visibleTiles >= 2) {
    // Tiles are loading — fade proportionally to both distance and tile coverage
    const distFactor = THREE.MathUtils.clamp((orbit.spherical.radius - 1.5) / 1.5, 0, 1);
    const tileFactor = THREE.MathUtils.clamp(1.0 - visibleTiles / 8, 0, 1);
    globe.setBaseOpacity(Math.max(distFactor, tileFactor));
  } else {
    // Few tiles — keep base mostly visible
    globe.setBaseOpacity(0.8);
  }

  // Tiles + markers
  tileManager.update();
  markerManager.update();

  // Zoom indicator
  const zoomName = getZoomLevelName(altitude);
  if (zoomName !== lastZoomDisplay) {
    lastZoomDisplay = zoomName;
    const zoomEl = document.getElementById('zoom-level');
    if (zoomEl) {
      zoomEl.textContent = zoomName;
      zoomEl.classList.remove('hidden');
      clearTimeout(zoomEl._hideTimer);
      zoomEl._hideTimer = setTimeout(() => zoomEl.classList.add('hidden'), 2500);
    }
  }

  renderer.render(scene, camera);
}

// ---- Loading Screen ----
const progress = document.querySelector('.loader-progress');
let lp = 0;
const li = setInterval(() => {
  lp += Math.random() * 15 + 5;
  if (lp >= 100) { lp = 100; clearInterval(li); setTimeout(() => document.getElementById('loader').classList.add('done'), 500); }
  progress.style.width = lp + '%';
}, 200);

clampAndApply();
animate();
