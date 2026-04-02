/**
 * API Client — connects frontend to Earth Geo backend
 */
import { auth } from './auth.js';

const API_BASE = window.EARTHGEO_CONFIG?.apiUrl || '/api';

class ApiClient {
  async request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = auth.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const resp = await fetch(url, { ...options, headers });
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `API error: ${resp.status}`);
    }

    return data;
  }

  // Flights
  async getFlights(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/flights${query ? '?' + query : ''}`);
  }

  async getFlight(id) {
    return this.request(`/flights/${id}`);
  }

  async createFlight(flightData) {
    return this.request('/flights', {
      method: 'POST',
      body: JSON.stringify(flightData),
    });
  }

  async uploadFlight(formData) {
    const token = auth.getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch(`${API_BASE}/flights`, {
      method: 'POST',
      headers,
      body: formData, // FormData for multipart/form-data
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Upload failed');
    return data;
  }

  async deleteFlight(id) {
    return this.request(`/flights/${id}`, { method: 'DELETE' });
  }

  // Likes
  async toggleLike(flightId) {
    return this.request(`/flights/${flightId}/like`, { method: 'POST' });
  }

  // Comments
  async getComments(flightId) {
    return this.request(`/flights/${flightId}/comments`);
  }

  async postComment(flightId, body, parentId = null) {
    return this.request(`/flights/${flightId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, parent_id: parentId }),
    });
  }

  // Profiles
  async getProfile(username) {
    return this.request(`/profiles/${username}`);
  }

  async getUserFlights(username) {
    return this.request(`/profiles/${username}/flights`);
  }

  // Stats
  async getStats() {
    return this.request('/stats');
  }

  // Trending
  async getTrending() {
    return this.request('/trending');
  }

  // Search
  async search(query) {
    return this.request(`/flights?search=${encodeURIComponent(query)}`);
  }
}

export const api = new ApiClient();
