/**
 * Marker Manager with Smart Clustering
 * 
 * - Clusters nearby markers when zoomed out
 * - Smoothly expands clusters as you zoom in
 * - Markers scale proportionally to camera distance (small when close, visible when far)
 * - Clean, minimal pins — not aggressive
 */
import * as THREE from 'three';

// Cluster distance thresholds at different zoom levels
const CLUSTER_THRESHOLDS = [
  { maxCamDist: 1.5, clusterRadius: 0 },       // Very zoomed — no clustering
  { maxCamDist: 2.0, clusterRadius: 0.03 },     // City level
  { maxCamDist: 2.5, clusterRadius: 0.06 },     // Region
  { maxCamDist: 3.0, clusterRadius: 0.10 },     // Country
  { maxCamDist: 4.0, clusterRadius: 0.15 },     // Continent
  { maxCamDist: 6.0, clusterRadius: 0.25 },     // Far out
  { maxCamDist: Infinity, clusterRadius: 0.35 }, // Full globe
];

export class MarkerManager {
  constructor(globeGroup, flights, camera) {
    this.globeGroup = globeGroup;
    this.flights = flights;
    this.camera = camera;
    this.markers = [];
    this.markerMeshes = [];
    this.meshToFlight = new Map();
    this.meshToCluster = new Map();
    this.clusterGroups = [];
    this.time = 0;
    this.lastCamDist = -1;
    this.needsRecluster = true;

    this.flightPositions = flights.map(f => ({
      flight: f,
      pos: this.latLngToVector3(f.lat, f.lng),
    }));

    this.rebuildMarkers();
  }

  latLngToVector3(lat, lng, radius = 1.012) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }

  getClusterRadius(camDist) {
    for (const t of CLUSTER_THRESHOLDS) {
      if (camDist <= t.maxCamDist) return t.clusterRadius;
    }
    return 0.35;
  }

  /**
   * Get marker scale factor based on camera distance.
   * Key insight: when zoomed WAY in, markers should be TINY so they don't
   * consume the screen. When zoomed out, they should be visible but not huge.
   */
  getMarkerScale(camDist) {
    // Camera distance ranges from ~1.002 (surface) to ~8.0 (far)
    // Markers should be tiny pins at close zoom, visible dots from space
    if (camDist <= 1.01) return 0.04;   // Tiny at street level
    if (camDist <= 1.05) return 0.08;   // Very small at neighborhood
    if (camDist <= 1.1) return 0.12;    // Small at city
    if (camDist <= 1.3) return 0.2;     // Small at region
    if (camDist <= 2.0) return 0.35;    // Medium at country
    if (camDist <= 3.5) return 0.6;     // Normal at continent
    return 1.0;                          // Full size from space
  }

  clusterFlights(clusterRadius) {
    if (clusterRadius <= 0) {
      return this.flightPositions.map(fp => ({
        flights: [fp.flight],
        center: fp.pos.clone(),
        isCluster: false,
      }));
    }

    const used = new Set();
    const clusters = [];
    const radiusSq = clusterRadius * clusterRadius;

    for (let i = 0; i < this.flightPositions.length; i++) {
      if (used.has(i)) continue;

      const cluster = {
        flights: [this.flightPositions[i].flight],
        center: this.flightPositions[i].pos.clone(),
        isCluster: false,
      };
      used.add(i);

      for (let j = i + 1; j < this.flightPositions.length; j++) {
        if (used.has(j)) continue;
        const distSq = this.flightPositions[i].pos.distanceToSquared(this.flightPositions[j].pos);
        if (distSq < radiusSq) {
          cluster.flights.push(this.flightPositions[j].flight);
          used.add(j);
        }
      }

      if (cluster.flights.length > 1) {
        cluster.isCluster = true;
        const avg = new THREE.Vector3();
        cluster.flights.forEach(f => {
          avg.add(this.latLngToVector3(f.lat, f.lng));
        });
        avg.divideScalar(cluster.flights.length);
        avg.normalize().multiplyScalar(1.012);
        cluster.center = avg;
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  clearAll() {
    this.clusterGroups.forEach(g => {
      this.globeGroup.remove(g);
      g.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    });
    this.clusterGroups = [];
    this.markerMeshes = [];
    this.meshToFlight.clear();
    this.meshToCluster.clear();
  }

  rebuildMarkers() {
    const camDist = this.camera ? this.camera.position.length() : 3.5;
    const clusterRadius = this.getClusterRadius(camDist);
    const clusters = this.clusterFlights(clusterRadius);

    this.clearAll();

    const scale = this.getMarkerScale(camDist);

    this.markers = [];
    for (const cluster of clusters) {
      if (cluster.isCluster) {
        this.createClusterMarker(cluster, scale);
      } else {
        this.createSingleMarker(cluster.flights[0], cluster.center, scale);
      }
    }
  }

  /**
   * Cluster marker — clean circle with count
   */
  createClusterMarker(cluster, scale) {
    const group = new THREE.Group();
    const pos = cluster.center;
    const count = cluster.flights.length;

    const categories = {};
    cluster.flights.forEach(f => {
      categories[f.category || 'default'] = (categories[f.category || 'default'] || 0) + 1;
    });
    const dominantCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0][0];
    const color = this.getCategoryColor(dominantCategory);

    // Simple filled dot — the main clickable element
    const dotSize = (0.006 + Math.min(count, 15) * 0.001) * scale;
    const dotGeometry = new THREE.SphereGeometry(dotSize, 16, 16);
    const dotMaterial = new THREE.MeshBasicMaterial({ color });
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.position.copy(pos);
    group.add(dot);

    // Subtle outer ring
    const ringSize = dotSize * 1.6;
    const ringGeometry = new THREE.RingGeometry(ringSize, ringSize + 0.003 * scale, 24);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(pos);
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    group.add(ring);

    // Count label — only show when scale is large enough to read
    if (scale > 0.2) {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(count > 99 ? '99+' : String(count), 32, 32);

      const labelTexture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({
        map: labelTexture,
        transparent: true,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      const spritePos = pos.clone().normalize().multiplyScalar(1.012 + 0.015 * scale);
      sprite.position.copy(spritePos);
      sprite.scale.set(0.03 * scale, 0.03 * scale, 1);
      group.add(sprite);
    }

    this.globeGroup.add(group);
    this.clusterGroups.push(group);
    this.markerMeshes.push(dot);
    this.meshToFlight.set(dot, cluster.flights[0]);
    this.meshToCluster.set(dot, cluster);
    this.markers.push({ group, ring, ringMaterial, isCluster: true, cluster });
  }

  /**
   * Single marker — small clean pin, no beam, subtle pulse
   */
  createSingleMarker(flight, pos, scale) {
    const group = new THREE.Group();
    const color = this.getCategoryColor(flight.category);

    // Pin dot — small sphere
    const dotSize = 0.005 * scale;
    const dotGeometry = new THREE.SphereGeometry(dotSize, 12, 12);
    const dotMaterial = new THREE.MeshBasicMaterial({ color });
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.position.copy(pos);
    group.add(dot);

    // Subtle ring (pulse will animate this)
    const ringGeometry = new THREE.RingGeometry(0.007 * scale, 0.01 * scale, 24);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(pos);
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    group.add(ring);

    this.globeGroup.add(group);
    this.clusterGroups.push(group);
    this.markerMeshes.push(dot);
    this.meshToFlight.set(dot, flight);
    this.markers.push({ group, dot, ring, ringMaterial, flight, isCluster: false });
  }

  getCategoryColor(category) {
    const colors = {
      landscape: 0x00d4ff,
      urban: 0x7b61ff,
      coastal: 0x00e676,
      mountain: 0xff6b6b,
      nature: 0x4ecdc4,
      sunset: 0xffa502,
      default: 0x00d4ff,
    };
    return colors[category] || colors.default;
  }

  getMarkerMeshes() {
    return this.markerMeshes;
  }

  getFlightByMesh(mesh) {
    return this.meshToFlight.get(mesh);
  }

  getClusterByMesh(mesh) {
    return this.meshToCluster.get(mesh);
  }

  addFlight(flight) {
    this.flights.push(flight);
    this.flightPositions.push({
      flight,
      pos: this.latLngToVector3(flight.lat, flight.lng),
    });
    this.needsRecluster = true;
  }

  update() {
    this.time += 0.016;

    if (this.camera) {
      const camDist = this.camera.position.length();
      const distDelta = Math.abs(camDist - this.lastCamDist);

      if (distDelta > 0.12 || this.needsRecluster) {
        this.lastCamDist = camDist;
        this.needsRecluster = false;
        this.rebuildMarkers();
        return;
      }
    }

    // Gentle pulse animation for rings
    for (const marker of this.markers) {
      if (marker.ringMaterial && marker.ring) {
        const speed = marker.isCluster ? 1.5 : 2.0;
        const id = marker.flight?.id || marker.cluster?.flights[0]?.id || 0;
        const pulse = 1 + Math.sin(this.time * speed + id * 0.7) * 0.15;
        marker.ring.scale.set(pulse, pulse, pulse);
        marker.ringMaterial.opacity = Math.max(0.08, 0.35 - (pulse - 1) * 1.0);
      }
    }
  }
}
