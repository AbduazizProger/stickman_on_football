// WebSocket link from the host screen to the relay server.
import type { HostMsg, PadMsg } from '../shared/protocol';

export class HostNet {
  private ws: WebSocket | null = null;
  room = '';
  ips: string[] = [];
  online = false;
  onRoom: (room: string, ips: string[]) => void = () => {};
  onPad: (slot: 0 | 1, m: PadMsg) => void = () => {};
  onJoin: (slot: 0 | 1) => void = () => {};
  onLeave: (slot: 0 | 1) => void = () => {};
  onStatus: (online: boolean) => void = () => {};
  private retry = 500;

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      let saved = '';
      try { saved = sessionStorage.getItem('room') || ''; } catch { /* ignore */ }
      ws.send(JSON.stringify({ t: 'host', room: saved }));
    };
    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'room') {
        this.room = m.room; this.ips = m.ips || []; this.online = true;
        try { sessionStorage.setItem('room', m.room); } catch { /* ignore */ }
        this.onStatus(true); this.onRoom(this.room, this.ips);
      } else if (m.t === 'pad') this.onPad(m.slot, m.m);
      else if (m.t === 'pad-join') this.onJoin(m.slot);
      else if (m.t === 'pad-leave') this.onLeave(m.slot);
    };
    ws.onclose = () => {
      this.online = false; this.onStatus(false);
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 1.6, 5000);
    };
  }

  to(slot: number, m: HostMsg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'to', slot, m }));
  }
}
