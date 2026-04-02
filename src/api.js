/**
 * Earth Geo — Unified API Client (Single Source of Truth)
 * Handles auth via our Express backend and all API calls.
 * Stores JWT in localStorage. Attaches Bearer token to all requests.
 */

const API_BASE =
  window.EARTHGEO_CONFIG?.API_BASE ||
  (window.location.hostname === 'localhost'
    ? 'http://localhost:3001/api'
    : '/api');

class EarthGeoAPI {
  constructor() {
    this.token = localStorage.getItem('earthgeo_token') || null;
    this.user = JSON.parse(localStorage.getItem('earthgeo_user') || 'null');
  }

  // ===================== Auth =====================

  async signIn(email, password) {
    const res = await fetch(`${API_BASE}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Login failed');
    if (data.token) {
      this._setSession(data.token, data.user);
    }
    return data;
  }

  async signUp(email, password, username) {
    const res = await fetch(`${API_BASE}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, username }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Signup failed');
    if (data.token) {
      this._setSession(data.token, data.user);
    }
    return data;
  }

  signOut() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('earthgeo_token');
    localStorage.removeItem('earthgeo_user');
    window.dispatchEvent(new CustomEvent('authChange', { detail: { user: null } }));
  }

  getUser() {
    return this.user;
  }

  isAuthenticated() {
    return !!this.token;
  }

  getToken() {
    return this.token;
  }

  // ===================== Internal helpers =====================

  _setSession(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('earthgeo_token', token);
    localStorage.setItem('earthgeo_user', JSON.stringify(user));
    window.dispatchEvent(new CustomEvent('authChange', { detail: { user } }));
  }

  /**
   * Generic JSON fetch helper. Attaches auth header if logged in.
   * Automatically signs out on 401.
   */
  async _fetch(endpoint, options = {}) {
    const headers = { ...options.headers };

    // Only set Content-Type for non-FormData requests
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.signOut();
      throw new Error('Session expired — please log in again');
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `API error ${res.status}`);
    }
    return data;
  }

  // ===================== Flights =====================

  async getFlights(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this._fetch(`/flights${query ? '?' + query : ''}`);
  }

  async getFlight(id) {
    return this._fetch(`/flights/${id}`);
  }

  /**
   * Upload a flight. Accepts FormData with:
   *   - video (File), title, description, latitude, longitude, location_name,
   *     drone_model, tags (JSON string array)
   * Supports an optional `onProgress` callback for XHR-based progress.
   */
  async uploadFlight(formData, onProgress) {
    if (onProgress) {
      return this._uploadWithProgress('/flights', formData, onProgress);
    }
    return this._fetch('/flights', {
      method: 'POST',
      body: formData, // FormData — Content-Type set automatically
    });
  }

  /** XHR-based upload with progress callback */
  _uploadWithProgress(endpoint, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data);
          } else {
            reject(new Error(data.error || `Upload failed (${xhr.status})`));
          }
        } catch {
          reject(new Error('Invalid response from server'));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload failed — network error')));
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

      xhr.open('POST', `${API_BASE}${endpoint}`);
      if (this.token) {
        xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
      }
      xhr.send(formData);
    });
  }

  async deleteFlight(id) {
    return this._fetch(`/flights/${id}`, { method: 'DELETE' });
  }

  // ===================== Likes =====================

  async toggleLike(flightId) {
    return this._fetch(`/flights/${flightId}/like`, { method: 'POST' });
  }

  // ===================== Comments =====================

  async getComments(flightId) {
    return this._fetch(`/flights/${flightId}/comments`);
  }

  async postComment(flightId, body, parentId = null) {
    return this._fetch(`/flights/${flightId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, parent_id: parentId }),
    });
  }

  // ===================== Profiles =====================

  async getProfile(username) {
    return this._fetch(`/profiles/${username}`);
  }

  async getUserFlights(username) {
    return this._fetch(`/profiles/${username}/flights`);
  }

  // ===================== Search & Discovery =====================

  async search(query) {
    return this._fetch(`/flights?search=${encodeURIComponent(query)}`);
  }

  async getTrending() {
    return this._fetch('/trending');
  }

  async getStats() {
    return this._fetch('/stats');
  }
}

// Export singleton — also attach to window for debugging
const api = new EarthGeoAPI();
window.earthgeoAPI = api;
export default api;
