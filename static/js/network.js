// Wraps the /ws/game connection: sends the player's current input on a
// fixed interval (not every animation frame — no need to, and it keeps
// bandwidth predictable), and auto-reconnects on drops that aren't caused
// by a bad token/mode/vehicle (those are fatal, everything else retries
// with backoff — Render's free tier occasionally recycles instances,
// so a transient drop is expected behavior, not a bug).

const FATAL_CLOSE_CODES = new Set([4001, 4002, 4003]);
const INPUT_SEND_MS = 66; // ~15/sec, matches server tick rate

class GameSocket {
  constructor({ token, mode, vehicle, onWelcome, onState, onDisconnect, onFatal }) {
    this.token = token;
    this.mode = mode;
    this.vehicle = vehicle;
    this.onWelcome = onWelcome;
    this.onState = onState;
    this.onDisconnect = onDisconnect;
    this.onFatal = onFatal;

    this.ws = null;
    this.shouldRun = true;
    this.reconnectDelay = 1000;
    this.input = { mx: 0, my: 0, aim: 0, firing: false };
    this._sendTimer = null;

    this._connect();
  }

  _connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ token: this.token, mode: this.mode, vehicle: this.vehicle });
    this.ws = new WebSocket(`${proto}://${location.host}/ws/game?${params.toString()}`);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this._sendTimer = setInterval(() => this._sendInput(), INPUT_SEND_MS);
    };

    this.ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === "welcome") this.onWelcome(msg);
      else if (msg.type === "state") this.onState(msg);
    };

    this.ws.onclose = (evt) => {
      clearInterval(this._sendTimer);
      if (FATAL_CLOSE_CODES.has(evt.code)) {
        this.shouldRun = false;
        if (this.onFatal) this.onFatal(evt.code);
        return;
      }
      if (this.onDisconnect) this.onDisconnect();
      if (this.shouldRun) {
        setTimeout(() => this._connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 8000);
      }
    };
  }

  setInput(mx, my, aim, firing) {
    this.input.mx = mx;
    this.input.my = my;
    this.input.aim = aim;
    this.input.firing = firing;
  }

  _sendInput() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "input", ...this.input }));
    }
  }

  close() {
    this.shouldRun = false;
    clearInterval(this._sendTimer);
    if (this.ws) this.ws.close();
  }
}
