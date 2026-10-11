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

  getFeed: (media) => request(media ? `/feed?media=${media}` : "/feed"),
  createPost: (payload) => request("/posts", { method: "POST", body: payload }),
  deletePost: (postId) => request(`/posts/${postId}`, { method: "DELETE" }),
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
  searchMatches: (q) =>
    request(`/matches/search?q=${encodeURIComponent(q)}`),
  joinMatch: (fixtureId) => request(`/matches/${fixtureId}/join`, { method: "POST" }),
  getMatchStats: (fixtureId) => request(`/matches/${fixtureId}/stats`),
  getMatchDetail: (fixtureId, q = "") => request(`/matches/${fixtureId}/detail${q}`),
  searchMatchesScoped: (q, scope = "all", days = 3, tz = "UTC") =>
    request(`/matches/search?q=${encodeURIComponent(q)}&scope=${scope}&days=${days}&timezone_name=${encodeURIComponent(tz)}`),
  getRecentMatches: (days = 3, tz = "UTC") =>
    request(`/matches/recent?days=${days}&timezone_name=${encodeURIComponent(tz)}`),

  getLocationRegions: (countryIso) => request(`/location/regions?country=${encodeURIComponent(countryIso)}`, { auth: false }),
  getLocationLocalities: (region) => request(`/location/localities?region=${encodeURIComponent(region)}`, { auth: false }),

  uploadMedia: (file) => {
    const formData = new FormData();
    formData.append("file", file, file.name);
    return request("/media/upload", { method: "POST", body: formData, isForm: true });
  },

  getComments: (postId) => request(`/posts/${postId}/comments`),
  addComment: (postId, payload) => request(`/posts/${postId}/comments`, { method: "POST", body: payload }),
  reactToComment: (commentId, emoji) => request(`/comments/${commentId}/react`, { method: "POST", body: { emoji } }),

  getUserProfile: (uid) => request(`/users/${uid}/profile`),
  getUserPosts: (uid) => request(`/users/${uid}/posts`),
  getUserLikedPosts: (uid) => request(`/users/${uid}/liked-posts`),
  getUserSharedPosts: (uid) => request(`/users/${uid}/shared-posts`),
  followUser: (uid) => request(`/follow/${uid}`, { method: "POST" }),
  createEduJournalEntry: (content) => request("/edu/journal", { method: "POST", body: { content } }),
  getEduJournal: () => request("/edu/journal"),
    getUpcomingMatches: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/matches/upcoming${qs ? "?" + qs : ""}`);
  },
  unfollowUser: (uid) => request(`/follow/${uid}`, { method: "DELETE" }),
  removeKlique: (uid) => request(`/klique/${uid}`, { method: "DELETE" }),
  getConversations: () => request("/conversations"),
  updateMe: (payload) => request("/users/me", { method: "PATCH", body: payload }),

  getNotifications: () => request("/notifications"),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () => request("/notifications/read-all", { method: "POST" }),
  sendNotification: (payload) => request("/notifications/send", { method: "POST", body: payload }),
  getUnreadNotificationCount: () => request("/notifications/unread-count"),
  getFollowers: () => request("/followers"),
  getPendingMembers: (groupId) => request(`/groups/${groupId}/pending`),
  approveMember: (groupId, uid) => request(`/groups/${groupId}/approve/${uid}`, { method: "POST" }),

  getMyGroups: () => request("/groups/mine"),
  addGroupMembers: (groupId, member_uids) => request(`/groups/${groupId}/members`, { method: "POST", body: { member_uids } }),
  joinGroupByLink: (groupId) => request(`/groups/${groupId}/join`, { method: "POST" }),
  createGroupEvent: (groupId, payload) => request(`/groups/${groupId}/events`, { method: "POST", body: payload }),
  getGroupEvents: (groupId) => request(`/groups/${groupId}/events`),

  createGroup: (payload) => request("/groups", { method: "POST", body: payload }),
  getGroup: (groupId) => request(`/groups/${groupId}`),
  updateGroup: (groupId, payload) => request(`/groups/${groupId}`, { method: "PATCH", body: payload }),
  matchContacts: (phone_numbers) => request("/contacts/match", { method: "POST", body: { phone_numbers } }),

  createStatus: (payload) => request("/status", { method: "POST", body: payload }),
  getStatusFeed: () => request("/status/feed"),

  getSettingsMenu: () => request("/settings/menu", { auth: false }),
  changePassword: (payload) => request("/settings/change-password", { method: "POST", body: payload }),
};

export { API_BASE, WS_BASE };
