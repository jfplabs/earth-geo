/**
 * TileManager — Quadtree-based satellite tile loading system for a Three.js globe
 *
 * Uses ESRI World Imagery tiles with Web Mercator (Slippy Map) coordinates.
 * Implements dynamic LOD, frustum culling, LRU texture caching, request
 * throttling, abort-on-stale, and smooth parent→child fade transitions.
 */
import * as THREE from 'three';

// ─── Constants ───────────────────────────────────────────────────────────────

const TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const GLOBE_RADIUS = 1.0;
const TILE_RADIUS = 1.001; // just above globe surface

const MIN_ZOOM = 0;
const MAX_ZOOM = 18;

const MAX_CONCURRENT_REQUESTS = 8;
const MAX_CACHED_TEXTURES = 500;

const TILE_SEGMENTS = 16; // subdivisions per tile patch (smooth curvature)
const FADE_SPEED = 6.0; // opacity units per second — fast appearance

const DEG2RAD = Math.PI / 180;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate a unique string key for a tile coordinate. */
function tileKey(z, x, y) {
  return `${z}/${x}/${y}`;
}

/** Convert tile column/row at zoom level to longitude/latitude bounds (degrees). */
function tileBounds(z, x, y) {
  const n = Math.pow(2, z);
  const lonLeft = (x / n) * 360 - 180;
  const lonRight = ((x + 1) / n) * 360 - 180;
  const latTop = tileToLat(y, n);
  const latBottom = tileToLat(y + 1, n);
  return { lonLeft, lonRight, latTop, latBottom };
}

function tileToLat(y, n) {
  const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return rad * (180 / Math.PI);
}

/**
 * Convert lat/lng (degrees) to a point on the sphere surface.
 * Uses geographic convention: lat [-90,90], lng [-180,180].
 * Three.js Y-up, sphere centered at origin.
 */
function latLngToVec3(lat, lng, radius) {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lng + 180) * DEG2RAD;
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** Approximate centre of a tile in 3D (for distance / visibility checks). */
function tileCentre3D(z, x, y) {
  const { lonLeft, lonRight, latTop, latBottom } = tileBounds(z, x, y);
  const lat = (latTop + latBottom) / 2;
  const lng = (lonLeft + lonRight) / 2;
  return latLngToVec3(lat, lng, TILE_RADIUS);
}

/** Angular radius (radians) subtended by a tile at the given zoom level. */
function tileAngularSize(z) {
  // At zoom 0 a single tile covers the full 360° longitude.
  // Each zoom halves the angular extent.
  return Math.PI / Math.pow(2, z);
}

// ─── LRU Texture Cache ──────────────────────────────────────────────────────

class LRUTextureCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    /** Map<string, { texture: THREE.Texture, lastUsed: number }> */
    this.entries = new Map();
    this._clock = 0;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    entry.lastUsed = ++this._clock;
    return entry.texture;
  }

  put(key, texture) {
    if (this.entries.has(key)) {
      const entry = this.entries.get(key);
      entry.texture = texture;
      entry.lastUsed = ++this._clock;
      return;
    }
    this.entries.set(key, { texture, lastUsed: ++this._clock });
    this._evict();
  }

  has(key) {
    return this.entries.has(key);
  }

  /** Evict least-recently-used entries until within budget. */
  _evict() {
    while (this.entries.size > this.maxSize) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.entries) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestKey = key;
        }
      }
      if (oldestKey !== null) {
        const entry = this.entries.get(oldestKey);
        if (entry.texture) entry.texture.dispose();
        this.entries.delete(oldestKey);
      }
    }
  }

  dispose() {
    for (const entry of this.entries.values()) {
      if (entry.texture) entry.texture.dispose();
    }
    this.entries.clear();
  }
}

// ─── Request Scheduler ───────────────────────────────────────────────────────

/**
 * Throttled fetch scheduler with abort support.
 * Limits concurrent network requests and lets callers abort stale ones.
 */
class RequestScheduler {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    /** @type {Array<{url:string, resolve:Function, reject:Function, abort:AbortController}>} */
    this.queue = [];
  }

  /**
   * Schedule an image fetch. Returns { promise, abort }.
   * `abort()` cancels the fetch if still pending/in-flight.
   */
  schedule(url) {
    const abortController = new AbortController();
    let rejectFn;

    const promise = new Promise((resolve, reject) => {
      rejectFn = reject;
      this.queue.push({ url, resolve, reject, abort: abortController });
      this._pump();
    });

    const abort = () => {
      abortController.abort();
      // Remove from queue if still waiting
      const idx = this.queue.findIndex((r) => r.abort === abortController);
      if (idx !== -1) {
        this.queue.splice(idx, 1);
        rejectFn(new DOMException('Aborted', 'AbortError'));
      }
    };

    return { promise, abort };
  }

  _pump() {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const req = this.queue.shift();
      if (req.abort.signal.aborted) {
        req.reject(new DOMException('Aborted', 'AbortError'));
        continue;
      }
      this.active++;
      this._fetch(req);
    }
  }

  async _fetch(req) {
    try {
      const response = await fetch(req.url, { signal: req.abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${req.url}`);
      const blob = await response.blob();
      if (req.abort.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const bitmap = await createImageBitmap(blob);
      req.resolve(bitmap);
    } catch (err) {
      req.reject(err);
    } finally {
      this.active--;
      this._pump();
    }
  }

  /** Abort everything in the queue and mark scheduler dead. */
  dispose() {
    for (const req of this.queue) {
      req.abort.abort();
      req.reject(new DOMException('Disposed', 'AbortError'));
    }
    this.queue.length = 0;
  }
}

// ─── Tile Geometry Builder ───────────────────────────────────────────────────

/**
 * Build a curved quad patch on the sphere for the given tile bounds.
 * Returns a BufferGeometry with position, normal, and uv attributes.
 */
function buildTileGeometry(z, x, y, segments = TILE_SEGMENTS) {
  const { lonLeft, lonRight, latTop, latBottom } = tileBounds(z, x, y);

  const segsU = segments;
  const segsV = segments;
  const vertCount = (segsU + 1) * (segsV + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  let idx = 0;
  for (let j = 0; j <= segsV; j++) {
    const v = j / segsV;
    const lat = latTop + (latBottom - latTop) * v; // top → bottom
    for (let i = 0; i <= segsU; i++) {
      const u = i / segsU;
      const lng = lonLeft + (lonRight - lonLeft) * u;
      const p = latLngToVec3(lat, lng, TILE_RADIUS);

      positions[idx * 3] = p.x;
      positions[idx * 3 + 1] = p.y;
      positions[idx * 3 + 2] = p.z;

      // Normal = normalised position (sphere centred at origin)
      const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      normals[idx * 3] = p.x / len;
      normals[idx * 3 + 1] = p.y / len;
      normals[idx * 3 + 2] = p.z / len;

      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;

      idx++;
    }
  }

  // Build index buffer
  const indexCount = segsU * segsV * 6;
  const useUint32 = vertCount > 65535;
  const indices = useUint32 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let ii = 0;
  for (let j = 0; j < segsV; j++) {
    for (let i = 0; i < segsU; i++) {
      const a = j * (segsU + 1) + i;
      const b = a + 1;
      const c = a + (segsU + 1);
      const d = c + 1;
      indices[ii++] = a;
      indices[ii++] = c;
      indices[ii++] = b;
      indices[ii++] = b;
      indices[ii++] = c;
      indices[ii++] = d;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  return geom;
}

// ─── Tile Material (with fade-in support) ────────────────────────────────────

function createTileMaterial(texture) {
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: true,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    side: THREE.FrontSide,
  });
  return mat;
}

// ─── TileNode (quadtree node) ────────────────────────────────────────────────

class TileNode {
  constructor(z, x, y) {
    this.z = z;
    this.x = x;
    this.y = y;
    this.key = tileKey(z, x, y);

    /** @type {THREE.Mesh|null} */
    this.mesh = null;
    /** @type {THREE.Texture|null} */
    this.texture = null;

    this.loaded = false;
    this.loading = false;
    this.opacity = 0;
    this.targetOpacity = 0; // 1 when visible, 0 when fading out

    /** Abort handle from RequestScheduler */
    this.abortFn = null;

    /** @type {TileNode[]|null} */
    this.children = null;

    // Pre-compute 3D centre & angular size for culling
    this.centre3D = tileCentre3D(z, x, y);
    this.angularSize = tileAngularSize(z);
  }

  dispose() {
    this.cancelLoad();
    if (this.mesh) {
      if (this.mesh.geometry) this.mesh.geometry.dispose();
      if (this.mesh.material) this.mesh.material.dispose();
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh = null;
    }
    // Texture is owned by the LRU cache, not disposed here.
    this.texture = null;
    this.loaded = false;
    this.loading = false;
    if (this.children) {
      for (const c of this.children) c.dispose();
      this.children = null;
    }
  }

  cancelLoad() {
    if (this.abortFn) {
      this.abortFn();
      this.abortFn = null;
      this.loading = false;
    }
  }
}

// ─── TileManager ─────────────────────────────────────────────────────────────

export class TileManager {
  /**
   * @param {THREE.Group} globeGroup  — the group containing the globe (tiles added here)
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(globeGroup, camera, renderer) {
    this.globeGroup = globeGroup;
    this.camera = camera;
    this.renderer = renderer;

    /** Container group for all tile meshes. */
    this.tileGroup = new THREE.Group();
    this.tileGroup.name = 'tileLayer';
    this.globeGroup.add(this.tileGroup);

    this.cache = new LRUTextureCache(MAX_CACHED_TEXTURES);
    this.scheduler = new RequestScheduler(MAX_CONCURRENT_REQUESTS);

    /** Map<key, TileNode> — all currently active nodes. */
    this.activeNodes = new Map();

    /** Frustum for visibility testing */
    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();

    this._visible = true;
    this._disposed = false;

    /** Geometry cache — shared geometries for tiles at the same z/x/y avoid duplication. */
    this._geomCache = new Map();

    /** Tracks time between frames for fade animation. */
    this._lastTime = performance.now();

    /** Previous activeNodes size for debug logging */
    this._lastActiveCount = 0;

    // Verify tile source on startup
    fetch('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/2/1/1')
      .then(r => { if (r.ok) console.log('[TileManager] ✅ ESRI tile source verified'); else console.warn('[TileManager] ❌ Tile source returned', r.status); })
      .catch(e => console.warn('[TileManager] ❌ Tile source unreachable:', e));
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Call every frame. Evaluates which tiles should be visible, starts loads,
   * cancels stale requests, and animates fade transitions.
   */
  update() {
    if (this._disposed || !this._visible) return;

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1); // cap delta
    this._lastTime = now;

    // Update frustum — ensure camera matrices are current
    this.camera.updateMatrixWorld();
    this._projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    // Determine desired zoom from camera distance
    const camDist = this.camera.position.length(); // globe at origin
    const desiredZoom = this._zoomForDistance(camDist);

    // Traverse quadtree, selecting tiles
    const wantedKeys = new Set();
    this._selectTiles(desiredZoom, wantedKeys);

    // Log active tile count changes
    if (this.activeNodes.size !== this._lastActiveCount) {

      this._lastActiveCount = this.activeNodes.size;
    }

    // Remove tiles that are no longer wanted (start fade-out)
    for (const [key, node] of this.activeNodes) {
      if (!wantedKeys.has(key)) {
        node.targetOpacity = 0;
      }
    }

    // Animate opacity & clean up fully faded nodes
    for (const [key, node] of this.activeNodes) {
      if (node.mesh && node.mesh.material) {
        // Animate towards target
        if (node.opacity < node.targetOpacity) {
          node.opacity = Math.min(node.opacity + FADE_SPEED * dt, node.targetOpacity);
        } else if (node.opacity > node.targetOpacity) {
          node.opacity = Math.max(node.opacity - FADE_SPEED * dt, node.targetOpacity);
        }
        node.mesh.material.opacity = node.opacity;
        node.mesh.visible = node.opacity > 0.001;
      }

      // Remove fully faded-out nodes
      if (node.targetOpacity === 0 && node.opacity <= 0.001 && !node.loading) {
        node.dispose();
        this.activeNodes.delete(key);
      }
    }
  }

  /**
   * Returns the number of tiles currently loaded and visible (opacity > 0.5).
   * Used by the main loop to decide when to fade the base globe.
   */
  getVisibleTileCount() {
    let count = 0;
    for (const node of this.activeNodes.values()) {
      if (node.loaded && node.opacity > 0.5) count++;
    }
    return count;
  }

  /** Show or hide the entire tile layer. */
  setVisible(bool) {
    this._visible = !!bool;
    this.tileGroup.visible = this._visible;
    if (!this._visible) {
      // Cancel all in-flight loads when hidden
      for (const node of this.activeNodes.values()) {
        node.cancelLoad();
      }
    }
  }

  /** Full cleanup — call when destroying the globe. */
  dispose() {
    this._disposed = true;
    for (const node of this.activeNodes.values()) {
      node.dispose();
    }
    this.activeNodes.clear();
    this.scheduler.dispose();
    this.cache.dispose();
    for (const geom of this._geomCache.values()) {
      geom.dispose();
    }
    this._geomCache.clear();
    if (this.tileGroup.parent) {
      this.tileGroup.parent.remove(this.tileGroup);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────

  /**
   * Map camera distance to a zoom level.
   *
   * At distance ~3.0 (far out), zoom 0–2.
   * At distance ~1.05 (surface skim), zoom 16–18.
   * Uses a logarithmic scale to match the exponential tile-size reduction.
   */
  _zoomForDistance(dist) {
    const altitude = Math.max(dist - GLOBE_RADIUS, 0.00001);
    // Google Earth-calibrated mapping:
    // alt 5.0 → z1, alt 2.0 → z2, alt 1.0 → z3, alt 0.5 → z4
    // alt 0.1 → z7, alt 0.01 → z10, alt 0.001 → z14, alt 0.0001 → z17
    const zoom = Math.floor(Math.log2(1.0 / altitude) * 1.8 + 0.5);
    return Math.max(1, Math.min(18, zoom));
  }

  /**
   * Select which tiles to show for the current view.
   * Start at zoom 1 (4 tiles) since zoom 0 is a single Mercator tile
   * that doesn't wrap the sphere well. Zoom 1 gives us 4 tiles covering
   * the globe with better geometry.
   */
  _selectTiles(desiredZoom, wantedKeys) {
    this._visitCount = 0;
    const n = Math.pow(2, 1); // start at zoom 1
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        this._visitTile(1, x, y, Math.max(desiredZoom, 1), wantedKeys);
      }
    }
  }

  /**
   * Recursive quadtree traversal for a single tile.
   * Decides whether to show this tile or subdivide into children.
   */
  _visitTile(z, x, y, desiredZoom, wantedKeys) {
    if (this._visitCount++ > 500) return; // safety valve
    const key = tileKey(z, x, y);

    // Frustum & back-face culling — skip tiles not facing the camera
    if (!this._isTileVisible(z, x, y)) {
      return;
    }

    // Should we subdivide?
    if (z < desiredZoom && z < MAX_ZOOM) {
      // Check if this tile is close enough to the camera to warrant subdivision.
      // Only subdivide if the tile is "large" relative to the screen.
      if (this._shouldSubdivide(z, x, y, desiredZoom)) {
        const cz = z + 1;
        const cx = x * 2;
        const cy = y * 2;
        this._visitTile(cz, cx, cy, desiredZoom, wantedKeys);
        this._visitTile(cz, cx + 1, cy, desiredZoom, wantedKeys);
        this._visitTile(cz, cx, cy + 1, desiredZoom, wantedKeys);
        this._visitTile(cz, cx + 1, cy + 1, desiredZoom, wantedKeys);

        // While children are loading, keep this tile visible as a fallback
        const allChildrenLoaded = this._areChildrenLoaded(cz, cx, cy);
        if (!allChildrenLoaded) {
          this._ensureTile(z, x, y, wantedKeys);
        }
        return;
      }
    }

    // Leaf tile — show it
    this._ensureTile(z, x, y, wantedKeys);
  }

  /**
   * Determine if a tile should be subdivided based on its projected screen
   * size relative to its distance from the camera.
   */
  _shouldSubdivide(z, x, y, desiredZoom) {
    const centre = tileCentre3D(z, x, y);
    const camPos = this.camera.position;
    const dist = camPos.distanceTo(centre);

    // Tile's approximate world-space size
    const tileWorldSize = (2 * Math.PI * TILE_RADIUS) / Math.pow(2, z);

    // Projected angular size from camera
    const angularSize = tileWorldSize / dist;

    // Subdivide if the tile is large on screen (> ~0.4 radians)
    // Also limit total active tiles by being stricter at higher zooms
    const threshold = z < 6 ? 0.5 : z < 12 ? 0.6 : 0.7;
    return angularSize > threshold;
  }

  /**
   * Check if all 4 children at (cz, cx, cy) are loaded and opaque.
   */
  _areChildrenLoaded(cz, cx, cy) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const key = tileKey(cz, cx + dx, cy + dy);
        const node = this.activeNodes.get(key);
        if (!node || !node.loaded || node.opacity < 0.95) return false;
      }
    }
    return true;
  }

  /**
   * Ensure a tile is active, loading, and marked wanted.
   */
  _ensureTile(z, x, y, wantedKeys) {
    const key = tileKey(z, x, y);
    wantedKeys.add(key);

    let node = this.activeNodes.get(key);
    if (!node) {
      node = new TileNode(z, x, y);
      this.activeNodes.set(key, node);
    }

    node.targetOpacity = 1;

    if (!node.loaded && !node.loading) {
      this._loadTile(node);
    }
  }

  /**
   * Visibility test: frustum culling + back-face culling.
   */
  _isTileVisible(z, x, y) {
    const centre = tileCentre3D(z, x, y);

    // Back-face cull: if the tile normal (= centre direction) points away
    // from the camera, the tile is on the far side of the globe.
    const camPos = this.camera.position;
    const toCamera = new THREE.Vector3().subVectors(camPos, centre);
    const normal = centre.clone().normalize();
    if (toCamera.dot(normal) < -0.2) {
      return false; // facing away — use generous threshold to avoid popping at edges
    }

    // Frustum cull using a bounding sphere for the tile
    // Approximate tile "radius" in world units
    const tileWorldRadius = (Math.PI * TILE_RADIUS) / Math.pow(2, z);
    const sphere = new THREE.Sphere(centre, tileWorldRadius);
    return this._frustum.intersectsSphere(sphere);
  }

  /**
   * Begin loading a tile's texture.
   */
  _loadTile(node) {
    const key = node.key;

    // Check cache first
    const cached = this.cache.get(key);
    if (cached) {

      this._applyTexture(node, cached);
      return;
    }

    node.loading = true;
    const url = TILE_URL.replace('{z}', node.z).replace('{y}', node.y).replace('{x}', node.x);


    const { promise, abort } = this.scheduler.schedule(url);
    node.abortFn = abort;

    promise
      .then((bitmap) => {
        if (this._disposed) return;

        const texture = new THREE.Texture(bitmap);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;

        this.cache.put(key, texture);
        this._applyTexture(node, texture);
      })
      .catch((err) => {
        if (err && err.name === 'AbortError') return; // expected
        console.error(`[TileManager] ❌ Failed to load tile ${key}:`, err);
        node.loading = false;
        node.abortFn = null;
      });
  }

  /**
   * Create or update the mesh for a loaded tile.
   */
  _applyTexture(node, texture) {
    node.loading = false;
    node.loaded = true;
    node.abortFn = null;
    node.texture = texture;

    if (!node.mesh) {
      const geom = this._getGeometry(node.z, node.x, node.y);
      const mat = createTileMaterial(texture);
      node.mesh = new THREE.Mesh(geom, mat);
      node.mesh.name = `tile_${node.key}`;
      node.mesh.renderOrder = 10 + node.z; // render above base globe
      node.mesh.frustumCulled = false; // we handle culling ourselves
      this.tileGroup.add(node.mesh);
    } else {
      node.mesh.material.map = texture;
      node.mesh.material.needsUpdate = true;
    }

    // Start at 0 opacity; the update() loop will fade it in
    if (node.opacity < 0.001) {
      node.opacity = 0;
    }
  }

  /**
   * Get (or create & cache) the geometry for a tile.
   * At higher zoom levels, many tiles share the same segment count but have
   * unique positions, so each tile gets its own geometry keyed by z/x/y.
   */
  _getGeometry(z, x, y) {
    const key = tileKey(z, x, y);
    let geom = this._geomCache.get(key);
    if (!geom) {
      // Use fewer segments for very small (high-zoom) tiles
      const segments = z <= 4 ? TILE_SEGMENTS : z <= 10 ? 8 : 4;
      geom = buildTileGeometry(z, x, y, segments);
      this._geomCache.set(key, geom);

      // Evict old geometries if the cache grows too large
      if (this._geomCache.size > MAX_CACHED_TEXTURES * 2) {
        this._evictGeometries();
      }
    }
    return geom;
  }

  /** Evict geometries not currently in use by any active node. */
  _evictGeometries() {
    const activeKeys = new Set(this.activeNodes.keys());
    for (const [key, geom] of this._geomCache) {
      if (!activeKeys.has(key)) {
        geom.dispose();
        this._geomCache.delete(key);
      }
    }
  }
}

export default TileManager;
