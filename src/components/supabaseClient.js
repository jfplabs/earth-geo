/**
 * Earth Geo — Supabase Client (Frontend)
 * Connects the frontend to Supabase for auth and data
 */

const SUPABASE_URL = window.EARTHGEO_CONFIG?.supabaseUrl || '';
const SUPABASE_ANON_KEY = window.EARTHGEO_CONFIG?.supabaseAnonKey || '';

class SupabaseClient {
  constructor(url, anonKey) {
    this.url = url;
    this.anonKey = anonKey;
    this.accessToken = localStorage.getItem('eg_access_token') || null;
    this.user = JSON.parse(localStorage.getItem('eg_user') || 'null');
  }

  async fetch(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'apikey': this.anonKey,
      ...(this.accessToken ? { 'Authorization': `Bearer ${this.accessToken}` } : {}),
      ...options.headers,
    };

    const res = await fetch(`${this.url}${endpoint}`, { ...options, headers });
    
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || err.msg || 'Request failed');
    }
    
    return res.json();
  }

  // ---- Auth ----

  async signUp(email, password, username) {
    const res = await this.fetch('/auth/v1/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, data: { username } }),
    });

    if (res.access_token) {
      this.setSession(res);
    }
    return res;
  }

  async signIn(email, password) {
    const res = await this.fetch('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (res.access_token) {
      this.setSession(res);
    }
    return res;
  }

  async signOut() {
    if (this.accessToken) {
      await this.fetch('/auth/v1/logout', {
        method: 'POST',
      }).catch(() => {});
    }
    this.clearSession();
  }

  setSession(data) {
    this.accessToken = data.access_token;
    this.user = data.user;
    localStorage.setItem('eg_access_token', data.access_token);
    localStorage.setItem('eg_user', JSON.stringify(data.user));
    if (data.refresh_token) {
      localStorage.setItem('eg_refresh_token', data.refresh_token);
    }
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: data.user } }));
  }

  clearSession() {
    this.accessToken = null;
    this.user = null;
    localStorage.removeItem('eg_access_token');
    localStorage.removeItem('eg_user');
    localStorage.removeItem('eg_refresh_token');
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: null } }));
  }

  isLoggedIn() {
    return !!this.accessToken && !!this.user;
  }

  getUser() {
    return this.user;
  }

  // ---- Flights (REST via PostgREST) ----

  async getFlights({ page = 1, limit = 50, sort = 'created_at.desc', search } = {}) {
    const offset = (page - 1) * limit;
    let endpoint = `/rest/v1/flights?status=eq.active&order=${sort}&offset=${offset}&limit=${limit}`;
    
    if (search) {
      endpoint += `&or=(title.ilike.%25${search}%25,location_name.ilike.%25${search}%25,description.ilike.%25${search}%25)`;
    }
    
    endpoint += '&select=*,profiles(username,display_name,avatar_url)';
    
    return this.fetch(endpoint);
  }

  async getFlight(id) {
    const data = await this.fetch(
      `/rest/v1/flights?id=eq.${id}&status=eq.active&select=*,profiles(username,display_name,avatar_url)`
    );
    return data[0] || null;
  }

  async createFlight(flightData) {
    return this.fetch('/rest/v1/flights', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        ...flightData,
        user_id: this.user.id,
        status: 'active',
      }),
    });
  }

  async deleteFlight(id) {
    return this.fetch(`/rest/v1/flights?id=eq.${id}&user_id=eq.${this.user.id}`, {
      method: 'DELETE',
    });
  }

  // ---- Likes ----

  async toggleLike(flightId) {
    // Check if already liked
    const existing = await this.fetch(
      `/rest/v1/likes?user_id=eq.${this.user.id}&flight_id=eq.${flightId}`
    );

    if (existing.length > 0) {
      await this.fetch(
        `/rest/v1/likes?user_id=eq.${this.user.id}&flight_id=eq.${flightId}`,
        { method: 'DELETE' }
      );
      return { liked: false };
    } else {
      await this.fetch('/rest/v1/likes', {
        method: 'POST',
        body: JSON.stringify({ user_id: this.user.id, flight_id: flightId }),
      });
      return { liked: true };
    }
  }

  async isLiked(flightId) {
    if (!this.isLoggedIn()) return false;
    const data = await this.fetch(
      `/rest/v1/likes?user_id=eq.${this.user.id}&flight_id=eq.${flightId}`
    );
    return data.length > 0;
  }

  // ---- Comments ----

  async getComments(flightId) {
    return this.fetch(
      `/rest/v1/comments?flight_id=eq.${flightId}&order=created_at.asc&select=*,profiles(username,display_name,avatar_url)`
    );
  }

  async addComment(flightId, body) {
    return this.fetch('/rest/v1/comments', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        flight_id: flightId,
        user_id: this.user.id,
        body,
      }),
    });
  }

  // ---- Profiles ----

  async getProfile(username) {
    const data = await this.fetch(`/rest/v1/profiles?username=eq.${username}`);
    return data[0] || null;
  }

  async updateProfile(updates) {
    return this.fetch(`/rest/v1/profiles?id=eq.${this.user.id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(updates),
    });
  }

  // ---- Storage (Video Upload) ----

  async uploadVideo(file, onProgress) {
    const ext = file.name.split('.').pop();
    const key = `videos/${this.user.id}/${Date.now()}.${ext}`;

    const formData = new FormData();
    formData.append('', file);

    const xhr = new XMLHttpRequest();
    
    return new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const publicUrl = `${this.url}/storage/v1/object/public/flights/${key}`;
          resolve({ key, url: publicUrl });
        } else {
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload failed')));

      xhr.open('POST', `${this.url}/storage/v1/object/flights/${key}`);
      xhr.setRequestHeader('apikey', this.anonKey);
      xhr.setRequestHeader('Authorization', `Bearer ${this.accessToken}`);
      xhr.send(file);
    });
  }

  // ---- Stats ----

  async getStats() {
    const [flights, profiles] = await Promise.all([
      this.fetch('/rest/v1/flights?status=eq.active&select=country_code'),
      this.fetch('/rest/v1/profiles?select=id', { headers: { 'Prefer': 'count=exact' } }),
    ]);

    const countries = new Set(flights.map(f => f.country_code).filter(Boolean));
    
    return {
      flights: flights.length,
      pilots: profiles.length,
      countries: countries.size,
    };
  }
}

// Export singleton
export const supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
