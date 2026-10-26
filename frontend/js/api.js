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

  getFeed: (media, opts = {}) => {
    const q = new URLSearchParams();
    if (media) q.set("media", media);
    if (opts.limit) q.set("limit", opts.limit);
    if (opts.before) q.set("before", opts.before);
    const s = q.toString();
    return request(s ? `/feed?${s}` : "/feed");
  },
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
  getMyClubs: () => request("/clubs/mine"),
  getProfileExtras: (uid) => request(`/profile-extras/${encodeURIComponent(uid)}`),
  getJobs: (p = {}) => {
    const q = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "" && v !== false) q.set(k, v); });
    const s = q.toString();
    return request(s ? `/jobs?${s}` : "/jobs");
  },
  createJob: (body) => request("/jobs", { method: "POST", body }),
  getJob: (id) => request(`/jobs/${id}`),
  setJobState: (id, state) => request(`/jobs/${id}/state`, { method: "POST", body: { state } }),
  bidJob: (id, body) => request(`/jobs/${id}/bids`, { method: "POST", body }),
  withdrawBid: (id) => request(`/jobs/${id}/bids/mine`, { method: "DELETE" }),
  setBidStatus: (id, bidId, status) => request(`/jobs/${id}/bids/${bidId}/status`, { method: "POST", body: { status } }),
  commentJob: (id, body) => request(`/jobs/${id}/comments`, { method: "POST", body }),
  pinJobComment: (id, cid) => request(`/jobs/${id}/comments/${cid}/pin`, { method: "POST" }),
  deleteJobComment: (id, cid) => request(`/jobs/${id}/comments/${cid}`, { method: "DELETE" }),
  getLiveHub: () => request("/live/hub"),
  createLive: (body) => request("/live/sessions", { method: "POST", body }),
  getLiveSession: (id) => request(`/live/sessions/${id}`),
  startLive: (id) => request(`/live/sessions/${id}/start`, { method: "POST" }),
  endLive: (id) => request(`/live/sessions/${id}/end`, { method: "POST" }),
  cancelLive: (id) => request(`/live/sessions/${id}/cancel`, { method: "POST" }),
  pollLive: (id, after) => request(`/live/sessions/${id}/poll`, { method: "POST", body: { after } }),
  sendLiveMessage: (id, content) => request(`/live/sessions/${id}/messages`, { method: "POST", body: { content } }),
  sendLiveGift: (id, body) => request(`/live/sessions/${id}/gift`, { method: "POST", body }),
  getLiveSupporters: (id) => request(`/live/sessions/${id}/supporters`),
  devStatus: () => request("/dev/status"),
  devGrant: (amount) => request("/dev/grant", { method: "POST", body: { amount } }),
  getPortfolioTemplates: () => request("/portfolio/templates"),
  getPortfolio: (uid) => request(`/portfolio/user/${encodeURIComponent(uid)}`),
  addPortfolioItem: (body) => request("/portfolio/items", { method: "POST", body }),
  updatePortfolioItem: (id, body) => request(`/portfolio/items/${id}`, { method: "PATCH", body }),
  deletePortfolioItem: (id) => request(`/portfolio/items/${id}`, { method: "DELETE" }),
  addCredential: (body) => request("/portfolio/credentials", { method: "POST", body }),
  deleteCredential: (id) => request(`/portfolio/credentials/${id}`, { method: "DELETE" }),
  uploadPortfolioFile: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request("/media/upload", { method: "POST", body: fd, isForm: true });
  },
  getManifest: () => request("/economy/manifest"),
  getWallet: () => request("/economy/wallet"),
  getLedger: (limit = 30) => request(`/economy/ledger?limit=${limit}`),
  doCheckin: () => request("/economy/checkin", { method: "POST" }),
  getSandclock: () => request("/sandclock/me"),
  pingActive: () => request("/sandclock/active", { method: "POST" }),
  getMyPlayers: () => request("/players/mine"),
  getPlayerProfile: (id, teamKey) => request(`/players/${encodeURIComponent(id)}/profile${teamKey ? `?team_key=${encodeURIComponent(teamKey)}` : ""}`),
  getPlayerCareer: (id, teamKey) => request(`/players/${encodeURIComponent(id)}/career?team_key=${encodeURIComponent(teamKey)}`),
  getUserPlayers: (uid) => request(`/players/user/${encodeURIComponent(uid)}`),
  followPlayer: (f) => request("/players/follow", {
    method: "POST",
    body: {
      key: f.id,
      name: f.name,
      sport: "football",
      player_id: f.playerId ? String(f.playerId) : null,
      team: f.team || null,
      team_key: f.teamKey ? String(f.teamKey) : null,
      number: f.number != null && f.number !== "" ? String(f.number) : null,
      position: f.position || null,
    },
  }),
  unfollowPlayer: (key) => request(`/players/follow?key=${encodeURIComponent(key)}`, { method: "DELETE" }),
  getUserClubs: (uid) => request(`/clubs/user/${encodeURIComponent(uid)}`),
  getClubProfile: (teamKey, sport = "football", name = "", logo = "") =>
    request(`/clubs/${encodeURIComponent(teamKey)}?sport=${sport}&name=${encodeURIComponent(name || "")}&logo=${encodeURIComponent(logo || "")}`),
  followClub: (teamKey, body, sport = "football") =>
    request(`/clubs/${encodeURIComponent(teamKey)}/follow?sport=${sport}`, { method: "POST", body }),
  unfollowClub: (teamKey, sport = "football") =>
    request(`/clubs/${encodeURIComponent(teamKey)}/follow?sport=${sport}`, { method: "DELETE" }),
  getMatchDetail: (fixtureId, q = "") => request(`/matches/${fixtureId}/detail${q}`),
  getSportList: (sport, scope = "all", q = "", days = 3, tz = "UTC") =>
    request(`/matches/sport/${sport}/list?scope=${scope}&q=${encodeURIComponent(q)}&days=${days}&timezone_name=${encodeURIComponent(tz)}`),
  getSportDetail: (sport, id, tz = "UTC") =>
    request(`/matches/sport/${sport}/${id}/detail?timezone_name=${encodeURIComponent(tz)}`),
  browseMatches: (scope = "all", days = 3, tz = "UTC", hours = 0, country = "") =>
    request(`/matches/browse?scope=${scope}&days=${days}&hours=${hours || 48}&country=${encodeURIComponent(country || "")}&timezone_name=${encodeURIComponent(tz)}`),
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
