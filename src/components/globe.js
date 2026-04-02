/**
 * Globe component — Google Earth-style satellite imagery globe
 * Flat, evenly-lit satellite texture with thin atmosphere rim.
 *
 * Hybrid rendering: base globe texture at far zoom + satellite tile overlay at close zoom.
 * The base earth sphere (radius 1.0) supports opacity fading so that a separate
 * tile layer (radius 1.001) can show through when the camera is close.
 */
import * as THREE from 'three';

// HD texture URLs
const TEXTURES = {
  // Standard day map
  day: 'https://unpkg.com/three-globe@2.41.12/example/img/earth-blue-marble.jpg',
  // HD version — NASA 5400x2700
  dayHD: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74092/world.200408.3x5400x2700.jpg',
  // Bump map for terrain relief
  bump: 'https://unpkg.com/three-globe@2.41.12/example/img/earth-topology.png',
};

/**
 * Progressive texture loader — loads low-res fast, swaps to HD
 */
function loadTextureProgressive(loader, lowUrl, hdUrl, onHDLoaded) {
  const texture = loader.load(lowUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;

  if (hdUrl) {
    loader.load(hdUrl, (hdTexture) => {
      hdTexture.colorSpace = THREE.SRGBColorSpace;
      hdTexture.anisotropy = 16;
      hdTexture.minFilter = THREE.LinearMipmapLinearFilter;
      hdTexture.magFilter = THREE.LinearFilter;
      hdTexture.generateMipmaps = true;
      if (onHDLoaded) onHDLoaded(hdTexture);
    });
  }

  return texture;
}

export class Globe {
  /**
   * @param {THREE.Scene} scene — the scene to (optionally) add the globe to.
   *        The globe group is always created; pass `null` to add it yourself later.
   */
  constructor(scene) {
    this.group = new THREE.Group();
    this._textureLoader = new THREE.TextureLoader();
    this._textureLoader.crossOrigin = 'anonymous';

    this._buildEarth();
    this._buildAtmosphere();

    if (scene) {
      scene.add(this.group);
    }
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /** Returns the Three.js group containing all globe layers. */
  getGroup() {
    return this.group;
  }

  /** Convenience alias used by external code that expects `getGlobeGroup`. */
  getGlobeGroup() {
    return this.group;
  }

  /** Returns the base earth mesh (radius 1.0). */
  getEarthMesh() {
    return this.earth;
  }

  /** Alias kept for discoverability. */
  getBaseEarthMesh() {
    return this.earth;
  }

  /** Returns the ShaderMaterial used on the earth sphere. */
  getEarthMaterial() {
    return this.earthMaterial;
  }

  /**
   * Set the base globe opacity (0 = fully transparent so tiles show, 1 = fully opaque).
   * This drives the `opacity` uniform in the earth shader AND toggles `transparent`
   * on the material so the depth-sort / blending behaves correctly.
   */
  setBaseOpacity(opacity) {
    const clamped = Math.max(0, Math.min(1, opacity));
    this.earthMaterial.uniforms.opacity.value = clamped;
    this.earthMaterial.transparent = clamped < 1.0;
    this.earthMaterial.depthWrite = clamped >= 0.99;
    this.earthMaterial.needsUpdate = true;
  }

  /**
   * Per-frame update — call from your render loop.
   * @param {THREE.Vector3} [sunDirection] — accepted for API compat, not used for lighting
   */
  update(sunDirection) {
    const sun = sunDirection || getSunDirection();
    // Update uniform for API compat (shader uses a fixed light direction, but keep uniform in sync)
    this.earthMaterial.uniforms.sunDirection.value.copy(sun);
  }

  // ------------------------------------------------------------------
  // Build helpers (private)
  // ------------------------------------------------------------------

  _buildEarth() {
    // High-poly sphere for smooth zoom — radius 1.0
    const geometry = new THREE.SphereGeometry(1, 256, 256);

    // Load textures progressively
    const dayTex = loadTextureProgressive(
      this._textureLoader,
      TEXTURES.day,
      TEXTURES.dayHD,
      (hdTex) => {
        this.earthMaterial.uniforms.dayTexture.value = hdTex;
        this.earthMaterial.needsUpdate = true;
        console.log('HD day texture loaded');
      },
    );

    const bumpTex = this._textureLoader.load(TEXTURES.bump);
    bumpTex.anisotropy = 16;

    // ========================================
    // GOOGLE EARTH-STYLE SHADER
    // Flat, evenly lit satellite imagery — like a well-lit photo.
    // Very subtle shading for 3D depth, no day/night cycle.
    // ========================================
    this.earthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        dayTexture: { value: dayTex },
        bumpTexture: { value: bumpTex },
        sunDirection: { value: new THREE.Vector3(1, 0.5, 1).normalize() },
        opacity: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormal;

        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D dayTexture;
        uniform float opacity;

        varying vec2 vUv;
        varying vec3 vNormal;

        void main() {
          vec3 color = texture2D(dayTexture, vUv).rgb;
          // Very subtle shading for 3D depth (not dramatic)
          vec3 normal = normalize(vNormal);
          float shade = 0.85 + 0.15 * max(dot(normal, vec3(0.0, 0.3, 1.0)), 0.0);
          color *= shade;
          gl_FragColor = vec4(color, opacity);
        }
      `,
      transparent: false,   // toggled to true by setBaseOpacity when < 1
      depthWrite: true,
    });

    this.earth = new THREE.Mesh(geometry, this.earthMaterial);
    this.group.add(this.earth);
    this.group.userData.earthMaterial = this.earthMaterial;
  }

  _buildAtmosphere() {
    // Very thin atmosphere — subtle blue rim like Google Earth
    const atmosphereGeometry = new THREE.SphereGeometry(1.008, 128, 128);
    const atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
          gl_FragColor = vec4(0.4, 0.6, 1.0, 1.0) * intensity * 0.3;
        }
      `,
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
    });
    this.atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    this.group.add(this.atmosphere);
  }
}

/**
 * Calculate sun direction based on current time.
 * Kept for API compatibility — other code calls this.
 */
export function getSunDirection() {
  const now = new Date();
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const solarLongitude = ((12 - utcHours) / 24) * 360;

  const dayOfYear = Math.floor(
    (now - new Date(now.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24),
  );
  const declination =
    23.44 * Math.sin(((360 / 365) * (dayOfYear - 81)) * (Math.PI / 180));

  const phi = (90 - declination) * (Math.PI / 180);
  const theta = (solarLongitude + 180) * (Math.PI / 180);

  return new THREE.Vector3(
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ).normalize();
}
