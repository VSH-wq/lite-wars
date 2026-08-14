// Everything on screen is drawn with canvas primitives - no sprite files.
// Vehicles are told apart by class silhouette (tank/plane/ship) plus a
// color that reflects team (Team War) or a per-player slot color (Free
// Play). The shape-drawing function is shared between the main battlefield
// and the lobby's vehicle-select preview icons, so what you pick is
// exactly what you see in-match - no separate "icon art" to keep in sync.

const GRID_SPACING = 150;

const MAP_THEMES = {
  ash: { bg: "#05070f", grid: "rgba(51,65,85,0.25)", void: "#03040a" },
  rust: { bg: "#0a0704", grid: "rgba(148,84,44,0.20)", void: "#080503" },
};

function lighten(hex, amount) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const nr = Math.min(255, Math.round(r + (255 - r) * amount));
  const ng = Math.min(255, Math.round(g + (255 - g) * amount));
  const nb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgb(${nr},${ng},${nb})`;
}

function roundRectPath(ctx, x, y, w, h, radius) {
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
}

function drawTank(ctx, r, bodyGrad, color) {
  const w = r * 1.6, h = r * 1.15;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(-w / 2 - 2, -h / 2 - 5, w + 4, 6);
  ctx.fillRect(-w / 2 - 2, h / 2 - 1, w + 4, 6);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < 5; i++) {
    const tx = -w / 2 + 4 + i * (w / 4.2);
    ctx.fillRect(tx, -h / 2 - 5, 3, 6);
    ctx.fillRect(tx, h / 2 - 1, 3, 6);
  }
  ctx.beginPath();
  roundRectPath(ctx, -w / 2, -h / 2, w, h, 5);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const turR = r * 0.42;
  ctx.beginPath();
  ctx.arc(r * 0.05, 0, turR, 0, Math.PI * 2);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(r * 0.3, -3);
  ctx.lineTo(r * 1.5, -1.5);
  ctx.lineTo(r * 1.5, 1.5);
  ctx.lineTo(r * 0.3, 3);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawPlane(ctx, r, bodyGrad, color) {
  ctx.beginPath();
  ctx.moveTo(r * 0.1, 0);
  ctx.lineTo(-r * 0.35, r * 1.15);
  ctx.lineTo(-r * 0.65, r * 1.0);
  ctx.lineTo(-r * 0.15, r * 0.15);
  ctx.closePath();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(r * 0.1, 0);
  ctx.lineTo(-r * 0.35, -r * 1.15);
  ctx.lineTo(-r * 0.65, -r * 1.0);
  ctx.lineTo(-r * 0.15, -r * 0.15);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-r * 0.85, 0);
  ctx.lineTo(-r * 1.15, -r * 0.35);
  ctx.lineTo(-r * 0.95, 0);
  ctx.lineTo(-r * 1.15, r * 0.35);
  ctx.closePath();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(r * 1.15, 0);
  ctx.quadraticCurveTo(r * 0.3, -r * 0.32, -r * 0.95, -r * 0.16);
  ctx.quadraticCurveTo(-r * 1.1, 0, -r * 0.95, r * 0.16);
  ctx.quadraticCurveTo(r * 0.3, r * 0.32, r * 1.15, 0);
  ctx.closePath();
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(r * 0.45, 0, r * 0.16, r * 0.09, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(224,242,254,0.7)";
  ctx.fill();
}

function drawShip(ctx, r, bodyGrad, color) {
  const w = r * 1.7, h = r * 0.85;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.quadraticCurveTo(w * 0.28, -h / 2, -w / 2 + 6, -h / 2);
  ctx.lineTo(-w / 2, -h / 2 * 0.6);
  ctx.lineTo(-w / 2, h / 2 * 0.6);
  ctx.lineTo(-w / 2 + 6, h / 2);
  ctx.quadraticCurveTo(w * 0.28, h / 2, w / 2, 0);
  ctx.closePath();
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(w / 2 - 4, -1);
  ctx.quadraticCurveTo(w * 0.2, -h / 2 + 3, -w / 2 + 10, -h / 2 + 3);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-w * 0.05, -h * 0.22, w * 0.22, h * 0.44);

  ctx.beginPath();
  ctx.moveTo(w * 0.3, -3);
  ctx.lineTo(w * 0.85, -1.5);
  ctx.lineTo(w * 0.85, 1.5);
  ctx.lineTo(w * 0.3, 3);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawVehicleShape(ctx, cls, r, color, opts = {}) {
  const { engineGlow = true, pulse = 0.5 } = opts;

  if (engineGlow) {
    const glowR = r * 0.9;
    const gx = -r * 1.1;
    const grad = ctx.createRadialGradient(gx, 0, 0, gx, 0, glowR);
    const a = 0.3 + pulse * 0.25;
    grad.addColorStop(0, `rgba(147,197,253,${a})`);
    grad.addColorStop(1, "rgba(147,197,253,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(gx, 0, glowR, 0, Math.PI * 2);
    ctx.fill();
  }

  const bodyGrad = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.1, 0, 0, r * 1.3);
  bodyGrad.addColorStop(0, lighten(color, 0.35));
  bodyGrad.addColorStop(1, color);

  if (cls === "plane") drawPlane(ctx, r, bodyGrad, color);
  else if (cls === "ship") drawShip(ctx, r, bodyGrad, color);
  else drawTank(ctx, r, bodyGrad, color);
}

const Renderer = {
  canvas: null,
  ctx: null,
  miniCanvas: null,
  miniCtx: null,
  worldSize: 3000,
  obstacles: [],
  vehicles: {},
  theme: MAP_THEMES.ash,
  explosions: [],

  init(canvas, miniCanvas, worldSize, obstacles, vehicles, mapTheme) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.miniCanvas = miniCanvas;
    this.miniCtx = miniCanvas.getContext("2d");
    this.worldSize = worldSize;
    this.obstacles = obstacles;
    this.vehicles = vehicles;
    this.theme = MAP_THEMES[mapTheme] || MAP_THEMES.ash;
    this.explosions = [];
    this.resize();
    window.addEventListener("resize", () => this.resize());
  },

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },

  spawnExplosion(x, y) {
    this.explosions.push({ x, y, start: performance.now() });
  },

  draw(state, selfId, colorFor) {
    const ctx = this.ctx;
    const self = state.players.find((p) => p.id === selfId);
    const camX = self ? self.x : this.worldSize / 2;
    const camY = self ? self.y : this.worldSize / 2;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.save();
    ctx.fillStyle = this.theme.void;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2 - camX, h / 2 - camY);

    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, this.worldSize, this.worldSize);

    this._drawGrid(camX, camY, w, h);
    this._drawWorldBounds();
    this._drawObstacles();
    for (const proj of state.projectiles) this._drawProjectile(proj);
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    for (const p of state.players) this._drawVehicle(p, p.id === selfId, colorFor(p), pulse);
    this._drawExplosions();

    ctx.restore();
    this._drawMinimap(state, selfId, colorFor);
  },

  _drawGrid(camX, camY, w, h) {
    const ctx = this.ctx;
    const startX = Math.floor((camX - w / 2) / GRID_SPACING) * GRID_SPACING;
    const startY = Math.floor((camY - h / 2) / GRID_SPACING) * GRID_SPACING;
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= camX + w / 2; x += GRID_SPACING) {
      ctx.moveTo(x, camY - h / 2);
      ctx.lineTo(x, camY + h / 2);
    }
    for (let y = startY; y <= camY + h / 2; y += GRID_SPACING) {
      ctx.moveTo(camX - w / 2, y);
      ctx.lineTo(camX + w / 2, y);
    }
    ctx.stroke();
  },

  _drawWorldBounds() {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(239,68,68,0.45)";
    ctx.lineWidth = 5;
    ctx.strokeRect(0, 0, this.worldSize, this.worldSize);
  },

  _drawObstacles() {
    for (const o of this.obstacles) {
      if (o.type === "rect") this._drawBunker(o);
      else this._drawRock(o);
    }
  },

  _drawRock(o) {
    const ctx = this.ctx;
    const grad = ctx.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.3, o.r * 0.15, o.x, o.y, o.r);
    grad.addColorStop(0, "#3a4256");
    grad.addColorStop(1, "#181d2b");
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "#4a5568";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(o.x - o.r * 0.25, o.y - o.r * 0.25, o.r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
  },

  _drawBunker(o) {
    const ctx = this.ctx;
    const x0 = o.x - o.w / 2, y0 = o.y - o.h / 2;
    const grad = ctx.createLinearGradient(x0, y0, x0, y0 + o.h);
    grad.addColorStop(0, "#4a4438");
    grad.addColorStop(1, "#1d1a15");
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, o.w, o.h);
    ctx.strokeStyle = "#5c5546";
    ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, o.w, o.h);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    for (const [rx, ry] of [[x0 + 6, y0 + 6], [x0 + o.w - 6, y0 + 6], [x0 + 6, y0 + o.h - 6], [x0 + o.w - 6, y0 + o.h - 6]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  _drawProjectile(proj) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(proj.x, proj.y);
    ctx.rotate(proj.a);
    const trail = ctx.createLinearGradient(-16, 0, 4, 0);
    trail.addColorStop(0, "rgba(253,230,138,0)");
    trail.addColorStop(1, "rgba(253,230,138,0.9)");
    ctx.fillStyle = trail;
    ctx.fillRect(-16, -1.5, 20, 3);
    ctx.beginPath();
    ctx.arc(4, 0, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fef3c7";
    ctx.shadowColor = "#fde68a";
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  },

  _drawExplosions() {
    const ctx = this.ctx;
    const now = performance.now();
    this.explosions = this.explosions.filter((e) => now - e.start < 500);
    for (const e of this.explosions) {
      const t = (now - e.start) / 500;
      const radius = 10 + t * 42;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.globalAlpha = 1 - t;
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      grad.addColorStop(0, "#fef3c7");
      grad.addColorStop(0.4, "#f97316");
      grad.addColorStop(1, "rgba(239,68,68,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },

  _drawVehicle(p, isSelf, color, pulse) {
    const ctx = this.ctx;
    const vdef = this.vehicles[p.v] || {};
    const r = vdef.radius || 20;
    const cls = vdef.cls || "tank";

    ctx.save();
    ctx.globalAlpha = p.al ? (p.prot ? 0.55 : 1) : 0.15;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.a);
    drawVehicleShape(ctx, cls, r, color, { engineGlow: p.al, pulse });
    if (isSelf) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(248,250,252,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = p.al ? 1 : 0.3;
    ctx.font = "11px 'Share Tech Mono', monospace";
    ctx.fillStyle = "rgba(248,250,252,0.85)";
    ctx.textAlign = "center";
    ctx.fillText(p.u, 0, -r - 16);

    const barW = 34;
    const pct = Math.max(0, p.hp / p.mhp);
    ctx.fillStyle = "rgba(15,18,35,0.8)";
    ctx.fillRect(-barW / 2, -r - 12, barW, 4);
    ctx.fillStyle = pct > 0.4 ? "#22c55e" : "#ef4444";
    ctx.fillRect(-barW / 2, -r - 12, barW * pct, 4);
    ctx.restore();
  },

  _drawMinimap(state, selfId, colorFor) {
    const ctx = this.miniCtx;
    const size = this.miniCanvas.width;
    const scale = size / this.worldSize;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(5,7,15,0.65)";
    ctx.fillRect(0, 0, size, size);

    for (const o of this.obstacles) {
      if (o.type === "rect") {
        ctx.fillStyle = "rgba(140,120,90,0.7)";
        ctx.fillRect((o.x - o.w / 2) * scale, (o.y - o.h / 2) * scale, Math.max(2, o.w * scale), Math.max(2, o.h * scale));
      } else {
        ctx.beginPath();
        ctx.arc(o.x * scale, o.y * scale, Math.max(2, o.r * scale), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(51,65,85,0.7)";
        ctx.fill();
      }
    }

    for (const p of state.players) {
      if (!p.al) continue;
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, p.id === selfId ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = p.id === selfId ? "#f8fafc" : colorFor(p);
      ctx.fill();
    }
  },

  drawPreview(canvas, vehicleDef) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 2);
    const scale = Math.min(w, h) / (vehicleDef.radius * 3.4);
    ctx.scale(scale, scale);
    drawVehicleShape(ctx, vehicleDef.cls, vehicleDef.radius, vehicleDef.color, { engineGlow: true, pulse: 0.4 });
    ctx.restore();
  },
};
