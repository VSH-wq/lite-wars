// Thin wrappers around the REST endpoints. Everything else (the actual
// match) goes over the WebSocket in network.js.

const Api = {
  async register(username, password) {
    return Api._post("/api/register", { username, password });
  },

  async login(username, password) {
    return Api._post("/api/login", { username, password });
  },

  async me(token) {
    const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Session invalid");
    return data;
  },

  async getVehicles() {
    const res = await fetch("/api/vehicles");
    if (!res.ok) throw new Error("Could not load vehicle list");
    return res.json();
  },

  async getLeaderboard() {
    const res = await fetch("/api/leaderboard");
    if (!res.ok) throw new Error("Could not load leaderboard");
    return res.json();
  },

  async _post(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.detail || "Request failed");
    }
    return data;
  },
};
