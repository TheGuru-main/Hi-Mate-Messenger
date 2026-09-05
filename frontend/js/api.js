// Hi-Mate frontend — API wrapper
// This is the legitimate frontend "local storage" use case discussed
// earlier: keeping the access token + a little cached state so reopening
// the app feels instant, NOT where uploaded media lives (that's the
// backend's cloud storage, unrelated to this file).

const API_BASE = "https://hi-mate-messenger-apiv1-0-0-1r.onrender.com/v1";
const WS_BASE = "wss://hi-mate-messenger-apiv1-0-0-1r.onrender.com";

export function getToken() {
  return localStorage.getItem("himate_token");
}
export function setToken(token) {
  localStorage.setItem("himate_token", token);
}
export function clearToken() {
  localStorage.removeItem("himate_token");
}
export function getCachedUser() {
  const raw = localStorage.getItem("himate_user");
  return raw ? JSON.parse(raw) : null;
}
export function setCachedUser(user) {
  localStorage.setItem("himate_user", JSON.stringify(user));
}

async function request(path, { method = "GET", body, auth = true, isForm = false } = {}) {
  const headers = {};
  if (!isForm) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* no body */
  }

  if (!res.ok) {
    const message = data?.detail
      ? typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail)
      : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  signup: (payload) => request("/auth/signup", { method: "POST", body: payload, auth: false }),
  verifyOtp: (payload) => request("/auth/otp/verify", { method: "POST", body: payload, auth: false }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload, auth: false }),
  getMe: () => request("/users/me"),

  getFeed: () => request("/feed"),
  createPost: (payload) => request("/posts", { method: "POST", body: payload }),
  react: (postId, emoji) => request(`/posts/${postId}/react`, { method: "POST", body: { emoji } }),

  search: (q, type) => request(`/search?q=${encodeURIComponent(q)}&type=${type}`),
  smartSearch: (q) => request(`/search/smart?q=${encodeURIComponent(q)}`),
  kliqueSuggestions: () => request("/search/klique-suggestions"),

  kliqueList: () => request("/klique/list"),
  kliquePending: () => request("/klique/pending"),
  kliqueRequest: (toUid) => request("/klique/request", { method: "POST", body: { to_uid: toUid } }),
  kliqueAccept: (requestId) => request("/klique/accept", { method: "POST", body: { request_id: requestId } }),

  getMessages: (conversationId) => request(`/messages/${conversationId}`),
  sendMessage: (payload) => request("/messages", { method: "POST", body: payload }),

  getLiveMatches: () => request("/matches/live"),
  joinMatch: (fixtureId) => request(`/matches/${fixtureId}/join`, { method: "POST" }),
  getMatchStats: (fixtureId) => request(`/matches/${fixtureId}/stats`),

  getSettingsMenu: () => request("/settings/menu", { auth: false }),
  changePassword: (payload) => request("/settings/change-password", { method: "POST", body: payload }),
};

export { API_BASE, WS_BASE };
