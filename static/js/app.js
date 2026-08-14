// Ties everything together: which screen is showing, the auth forms, the
// vehicle/mode picker, the leaderboard, and - once deployed - capturing
// input each frame and handing the server's state snapshots to the
// renderer with light interpolation so 15 updates/sec still looks smooth
// at 60fps.

const FREE_PALETTE = ["#f97316", "#eab308", "#84cc16", "#06b6d4", "#8b5cf6", "#ec4899", "#f43f5e", "#14b8a6", "#a3e635", "#38bdf8"];
const STORAGE_KEY = "frontline_session";
const LEADERBOARD_TABS = [
  { cat: "level", label: "LEVEL" },
  { cat: "kills_overall", label: "KILLS (ALL)" },
  { cat: "kills_team", label: "KILLS (TEAM WAR)" },
  { cat: "kills_free", label: "KILLS (FREE PLAY)" },
  { cat: "kd_ratio", label: "K/D RATIO" },
];

const App = {
  vehicles: {},
  selectedVehicle: null,
  selectedMode: null,
  session: null, // { token, username, kills, deaths, level, exp, progress, ... }

  socket: null,
  inMatch: false,
  selfId: null,
  prevState: null,
  curState: null,
  killFeed: [],
  freeColors: new Map(),
  prevAliveById: new Map(),
  keys: new Set(),
  mouseX: 0,
  mouseY: 0,
  firing: false,
  deathAt: null,
  respawnSeconds: 3,

  leaderboardData: null,
  leaderboardCat: "level",

  async init() {
    this._wireAuthScreen();
    this._wireLobbyScreen();
    this._wireLeaderboardScreen();
    this._wireGameScreen();

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const cached = JSON.parse(saved);
        const fresh = await Api.me(cached.token);
        this.session = { token: cached.token, ...fresh };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
        await this._enterLobby();
        return;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    this._showScreen("auth");
  },

  // ---------------------------------------------------------------- auth

  _wireAuthScreen() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const isLogin = tab.dataset.tab === "login";
        document.getElementById("form-login").classList.toggle("hidden", !isLogin);
        document.getElementById("form-register").classList.toggle("hidden", isLogin);
        this._authError("");
      });
    });

    document.getElementById("form-login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value;
      try {
        const res = await Api.login(username, password);
        this.session = res;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
        this._authError("");
        await this._enterLobby();
      } catch (err) {
        this._authError(err.message);
      }
    });

    document.getElementById("form-register").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("register-username").value.trim();
      const password = document.getElementById("register-password").value;
      try {
        await Api.register(username, password);
        const res = await Api.login(username, password);
        this.session = res;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
        this._authError("");
        await this._enterLobby();
      } catch (err) {
        this._authError(err.message);
      }
    });
  },

  _authError(msg) {
    const el = document.getElementById("auth-error");
    el.textContent = msg;
    el.classList.toggle("hidden", !msg);
  },

  // --------------------------------------------------------------- lobby

  _wireLobbyScreen() {
    document.getElementById("btn-logout").addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      this.session = null;
      this._showScreen("auth");
    });

    document.getElementById("btn-leaderboard").addEventListener("click", () => this._openLeaderboard());

    document.querySelectorAll(".mode-card").forEach((card) => {
      card.addEventListener("click", () => {
        document.querySelectorAll(".mode-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        this.selectedMode = card.dataset.mode;
        this._refreshDeployState();
      });
    });

    document.getElementById("btn-deploy").addEventListener("click", () => this._deploy());
  },

  async _enterLobby() {
    this._updateLobbyStatsDisplay();

    if (Object.keys(this.vehicles).length === 0) {
      this.vehicles = await Api.getVehicles();
      this._buildVehicleGrid();
    }
    this._showScreen("lobby");
  },

  _updateLobbyStatsDisplay() {
    const s = this.session;
    document.getElementById("lobby-username").textContent = s.username;
    document.getElementById("lobby-kills").textContent = s.kills;
    document.getElementById("lobby-deaths").textContent = s.deaths;
    document.getElementById("lobby-level").textContent = s.level;
    document.getElementById("lobby-level-fill").style.width = `${Math.round((s.progress || 0) * 100)}%`;
    document.getElementById("lobby-exp-label").textContent = `${s.exp - s.level_floor} / ${s.level_ceiling - s.level_floor} XP`;
  },

  async _refreshSessionStats() {
    try {
      const fresh = await Api.me(this.session.token);
      this.session = { ...this.session, ...fresh };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
      this._updateLobbyStatsDisplay();
    } catch {
      // Non-fatal here - the lobby just shows slightly stale numbers until
      // the next successful refresh. Only WS auth failures force a logout.
    }
  },

  _buildVehicleGrid() {
    const grid = document.getElementById("vehicle-grid");
    grid.innerHTML = "";
    const list = Object.values(this.vehicles);
    const maxes = {
      speed: Math.max(...list.map((v) => v.speed)),
      hp: Math.max(...list.map((v) => v.hp)),
      damage: Math.max(...list.map((v) => v.damage)),
      rate: Math.max(...list.map((v) => 1 / v.cooldown)),
    };

    for (const v of list) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "vehicle-card";
      card.dataset.vehicle = v.id;

      const top = document.createElement("div");
      top.className = "vehicle-card-top";

      const icon = document.createElement("canvas");
      icon.className = "vehicle-icon";
      icon.width = 56;
      icon.height = 56;

      const title = document.createElement("div");
      title.className = "vehicle-card-title";
      const name = document.createElement("span");
      name.className = "vehicle-name";
      name.textContent = v.name;
      const cls = document.createElement("span");
      cls.className = "vehicle-class";
      cls.textContent = v.cls;
      title.append(name, cls);
      top.append(icon, title);

      const blurb = document.createElement("p");
      blurb.className = "vehicle-blurb";
      blurb.textContent = v.blurb;

      card.append(
        top,
        blurb,
        this._statRow("SPD", v.speed, maxes.speed),
        this._statRow("HP", v.hp, maxes.hp),
        this._statRow("DMG", v.damage, maxes.damage),
        this._statRow("RATE", 1 / v.cooldown, maxes.rate),
      );

      card.addEventListener("click", () => {
        document.querySelectorAll(".vehicle-card").forEach((c) => c.classList.remove("selected"));
        card.classList.add("selected");
        this.selectedVehicle = v.id;
        this._refreshDeployState();
      });

      grid.appendChild(card);
      Renderer.drawPreview(icon, v);
    }
  },

  _statRow(label, val, max) {
    const row = document.createElement("div");
    row.className = "stat-row";
    const lab = document.createElement("span");
    lab.className = "stat-label";
    lab.textContent = label;
    const track = document.createElement("div");
    track.className = "stat-track";
    const fill = document.createElement("div");
    fill.className = "stat-fill";
    fill.style.width = `${Math.round((val / max) * 100)}%`;
    track.appendChild(fill);
    row.append(lab, track);
    return row;
  },

  _refreshDeployState() {
    const ready = this.selectedVehicle && this.selectedMode;
    document.getElementById("btn-deploy").disabled = !ready;
    document.getElementById("lobby-hint").textContent = ready
      ? "Ready. Hit deploy when you are."
      : "Pick a machine and a front to deploy.";
  },

  // --------------------------------------------------------- leaderboard

  _wireLeaderboardScreen() {
    document.getElementById("btn-leaderboard-back").addEventListener("click", () => this._showScreen("lobby"));
    const tabsEl = document.getElementById("leaderboard-tabs");
    for (const { cat, label } of LEADERBOARD_TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lb-tab" + (cat === this.leaderboardCat ? " active" : "");
      btn.textContent = label;
      btn.dataset.cat = cat;
      btn.addEventListener("click", () => {
        this.leaderboardCat = cat;
        tabsEl.querySelectorAll(".lb-tab").forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
        this._renderLeaderboardList();
      });
      tabsEl.appendChild(btn);
    }
  },

  async _openLeaderboard() {
    this._showScreen("leaderboard");
    const list = document.getElementById("leaderboard-list");
    list.innerHTML = `<p class="hint">Loading...</p>`;
    try {
      this.leaderboardData = await Api.getLeaderboard();
      this._renderLeaderboardList();
    } catch {
      list.innerHTML = `<p class="hint">Couldn't load the leaderboard - try again in a moment.</p>`;
    }
  },

  _renderLeaderboardList() {
    const list = document.getElementById("leaderboard-list");
    list.innerHTML = "";
    const rows = (this.leaderboardData && this.leaderboardData[this.leaderboardCat]) || [];
    if (rows.length === 0) {
      list.innerHTML = `<p class="hint">Nobody's on the board yet - be the first.</p>`;
      return;
    }
    rows.forEach((row, i) => {
      const item = document.createElement("div");
      item.className = "lb-row" + (row.username === this.session?.username ? " lb-row-self" : "");

      const rank = document.createElement("span");
      rank.className = "lb-rank";
      rank.textContent = `#${i + 1}`;

      const name = document.createElement("span");
      name.className = "lb-name";
      name.textContent = row.username;

      const value = document.createElement("span");
      value.className = "lb-value";
      value.textContent = this.leaderboardCat === "level"
        ? `Lvl ${row.level}`
        : this.leaderboardCat === "kd_ratio"
          ? `${row.value.toFixed(2)} (${row.kills}/${row.deaths})`
          : row.value;

      item.append(rank, name, value);
      list.appendChild(item);
    });
  },

  // ---------------------------------------------------------------- game

  _wireGameScreen() {
    document.getElementById("btn-leave").addEventListener("click", () => this._leaveMatch());

    window.addEventListener("keydown", (e) => {
      if (this.inMatch) this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));

    const canvas = document.getElementById("game-canvas");
    canvas.addEventListener("mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    canvas.addEventListener("mousedown", () => (this.firing = true));
    window.addEventListener("mouseup", () => (this.firing = false));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  },

  _deploy() {
    this._showScreen("game");
    this._connectionBanner("Connecting to the front... (can take up to a minute if the server's been idle)");

    this.prevState = null;
    this.curState = null;
    this.killFeed = [];
    this.freeColors = new Map();
    this.prevAliveById = new Map();
    this.deathAt = null;

    this.socket = new GameSocket({
      token: this.session.token,
      mode: this.selectedMode,
      vehicle: this.selectedVehicle,
      onWelcome: (msg) => this._onWelcome(msg),
      onState: (msg) => this._onState(msg),
      onDisconnect: () => this._connectionBanner("Connection dropped. Reconnecting..."),
      onFatal: () => this._onFatal(),
    });

    this.inMatch = true;
    requestAnimationFrame(() => this._frame());
  },

  _onWelcome(msg) {
    this.selfId = msg.id;
    this.respawnSeconds = msg.respawn_seconds || 3;
    Renderer.init(
      document.getElementById("game-canvas"),
      document.getElementById("minimap"),
      msg.world_size,
      msg.obstacles,
      msg.vehicles,
      msg.map_theme,
    );
    const modeLabel = this.selectedMode === "team" ? `TEAM WAR — ${(msg.team || "").toUpperCase()}` : "FREE PLAY";
    document.getElementById("hud-mode").textContent = `${modeLabel}  ·  ${msg.map_name}`;
    this._connectionBanner(null);
  },

  _onState(msg) {
    this.prevState = this.curState;
    this.curState = { ...msg, receivedAt: performance.now() };

    for (const evt of msg.events || []) {
      if (evt.type === "kill") {
        this.killFeed.unshift({ killer: evt.killer, victim: evt.victim, at: Date.now() });
      } else if (evt.type === "levelup" && evt.username === this.session?.username) {
        this._showLevelUpToast(evt.level);
      }
    }
    this.killFeed = this.killFeed.filter((e) => Date.now() - e.at < 6000).slice(0, 5);
    this._renderKillFeed();
    this._detectDeaths(msg.players);

    const self = msg.players.find((p) => p.id === this.selfId);
    if (self) {
      const fill = document.getElementById("health-fill");
      const pct = Math.max(0, self.hp / self.mhp) * 100;
      fill.style.width = `${pct}%`;
      fill.style.background = pct > 40 ? "var(--accent)" : "var(--danger)";
      document.getElementById("health-label").textContent = `${Math.ceil(self.hp)} / ${self.mhp} HP  ·  K ${self.k}  D ${self.d}`;

      const overlay = document.getElementById("respawn-overlay");
      if (!self.al) {
        if (this.deathAt === null) this.deathAt = Date.now();
        overlay.classList.remove("hidden");
      } else {
        this.deathAt = null;
        overlay.classList.add("hidden");
      }
    }
  },

  _detectDeaths(players) {
    // Any tracked player (not just the local one) whose alive flag just
    // flipped true->false gets a brief explosion at their last position -
    // purely cosmetic, driven off the same state broadcast everything
    // else uses, no extra server messages needed.
    for (const p of players) {
      const wasAlive = this.prevAliveById.get(p.id);
      if (wasAlive === true && p.al === false) {
        Renderer.spawnExplosion(p.x, p.y);
      }
      this.prevAliveById.set(p.id, p.al);
    }
  },

  _showLevelUpToast(level) {
    const toast = document.getElementById("levelup-toast");
    document.getElementById("levelup-toast-level").textContent = `LEVEL ${level}`;
    toast.classList.remove("hidden");
    toast.classList.remove("levelup-toast-show");
    void toast.offsetWidth; // restart the animation if it's already showing
    toast.classList.add("levelup-toast-show");
    clearTimeout(this._levelupTimeout);
    this._levelupTimeout = setTimeout(() => toast.classList.add("hidden"), 2600);
  },

  _renderKillFeed() {
    const el = document.getElementById("hud-killfeed");
    el.innerHTML = "";
    for (const k of this.killFeed) {
      const line = document.createElement("div");
      line.className = "kill-feed-line";
      const killerB = document.createElement("b");
      killerB.textContent = k.killer || "???";
      const victimB = document.createElement("b");
      victimB.textContent = k.victim;
      line.append(killerB, document.createTextNode(" downed "), victimB);
      el.appendChild(line);
    }
  },

  _onFatal() {
    this.inMatch = false;
    localStorage.removeItem(STORAGE_KEY);
    this.session = null;
    this._showScreen("auth");
    this._authError("Your session expired — log in again.");
  },

  _connectionBanner(text) {
    const el = document.getElementById("connection-banner");
    if (!text) {
      el.classList.add("hidden");
      return;
    }
    el.textContent = text;
    el.classList.remove("hidden");
  },

  _leaveMatch() {
    this.inMatch = false;
    if (this.socket) this.socket.close();
    this.socket = null;
    this._showScreen("lobby");
    document.getElementById("respawn-overlay").classList.add("hidden");
    this._refreshSessionStats();
  },

  _frame() {
    if (!this.inMatch) return;

    let mx = 0, my = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) my -= 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) my += 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) mx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) mx += 1;
    const aim = Math.atan2(this.mouseY - window.innerHeight / 2, this.mouseX - window.innerWidth / 2);
    if (this.socket) this.socket.setInput(mx, my, aim, this.firing);

    const renderState = this._interpolatedState();
    if (renderState) Renderer.draw(renderState, this.selfId, (p) => this._colorFor(p));

    if (this.deathAt !== null) {
      const remaining = Math.max(0, this.respawnSeconds - (Date.now() - this.deathAt) / 1000);
      document.getElementById("respawn-timer").textContent = `Redeploying in ${remaining.toFixed(1)}s`;
    }

    requestAnimationFrame(() => this._frame());
  },

  _interpolatedState() {
    if (!this.curState) return null;
    if (!this.prevState) return this.curState;

    const elapsed = performance.now() - this.curState.receivedAt;
    const t = Math.min(1, elapsed / 66);
    const prevPlayers = new Map(this.prevState.players.map((p) => [p.id, p]));
    const prevProj = new Map(this.prevState.projectiles.map((p) => [p.id, p]));

    return {
      ...this.curState,
      players: this.curState.players.map((cp) => {
        const pp = prevPlayers.get(cp.id);
        if (!pp) return cp;
        return { ...cp, x: lerp(pp.x, cp.x, t), y: lerp(pp.y, cp.y, t), a: lerpAngle(pp.a, cp.a, t) };
      }),
      projectiles: this.curState.projectiles.map((cp) => {
        const pp = prevProj.get(cp.id);
        if (!pp) return cp;
        return { ...cp, x: lerp(pp.x, cp.x, t), y: lerp(pp.y, cp.y, t) };
      }),
    };
  },

  _colorFor(p) {
    if (p.t === "red") return "#ef4444";
    if (p.t === "blue") return "#3b82f6";
    if (!this.freeColors.has(p.id)) {
      this.freeColors.set(p.id, FREE_PALETTE[this.freeColors.size % FREE_PALETTE.length]);
    }
    return this.freeColors.get(p.id);
  },

  _showScreen(name) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
    document.getElementById(`screen-${name}`).classList.remove("hidden");
  },
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

App.init();
