/**
 * Earth Geo — API Client
 * Handles all communication between frontend and backend
 */

const API_BASE = window.location.hostname === 'localhost' 
  ? 'http://localhost:3001/api'
  : '/api';

// Supabase client for auth (loaded from CDN)
let supabaseClient = null;

export function initSupabase(url, anonKey) {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(url, anonKey);
  }
  return supabaseClient;
}

export function getSupabase() {
  return supabaseClient;
}

// ---- Auth ----

export async function signUp(email, password, username) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { username },
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session;
}

export async function getUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  return user;
}

// ---- API Helpers ----

async function getAuthHeaders() {
  const session = await getSession();
  const headers = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

async function apiGet(path) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function apiPostForm(path, formData) {
  const session = await getSession();
  const headers = {};
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function apiDelete(path) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ---- Flights ----

export async function getFlights(params = {}) {
  const query = new URLSearchParams(params).toString();
  return apiGet(`/flights${query ? '?' + query : ''}`);
}

export async function getFlight(id) {
  return apiGet(`/flights/${id}`);
}

export async function uploadFlight(formData) {
  return apiPostForm('/flights', formData);
}

export async function deleteFlight(id) {
  return apiDelete(`/flights/${id}`);
}

// ---- Likes ----

export async function toggleLike(flightId) {
  return apiPost(`/flights/${flightId}/like`);
}

// ---- Comments ----

export async function getComments(flightId) {
  return apiGet(`/flights/${flightId}/comments`);
}

export async function postComment(flightId, body, parentId = null) {
  return apiPost(`/flights/${flightId}/comments`, { body, parent_id: parentId });
}

// ---- Profiles ----

export async function getProfile(username) {
  return apiGet(`/profiles/${username}`);
}

export async function getUserFlights(username) {
  return apiGet(`/profiles/${username}/flights`);
}

// ---- Stats ----

export async function getStats() {
  return apiGet('/stats');
}

// ---- Trending ----

export async function getTrending() {
  return apiGet('/trending');
}
