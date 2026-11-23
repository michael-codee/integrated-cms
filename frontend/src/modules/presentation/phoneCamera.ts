/**
 * Phones as live camera sources for the screens.
 *
 * A phone (on the remote page) sends its camera to the control desk with WebRTC. Only the short
 * set-up messages (offer and answer) go through the server, with the remote's other traffic; the
 * picture itself goes straight from the phone to the media computer over the church Wi-Fi, or
 * through the internet when the two are on different networks. Several phones can send at once on
 * one remote link: each names its camera with a short random id (`cid`).
 *
 * The desk passes every phone picture on to the projector window on the same computer through
 * local WebRTC links set up over a BroadcastChannel, so they reach the screen without going out
 * of the computer again.
 */
import { useSyncExternalStore } from 'react';

/** Camera source ids: a device id on this computer, or `phone:<cid>`. Plain "phone" = the first phone. */
export const PHONE_CAMERA = 'phone';
export const phoneSourceId = (cid: string) => `phone:${cid}`;
export const isPhoneSource = (id?: string | null) => !!id && (id === PHONE_CAMERA || id.startsWith('phone:'));

/** For phone ↔ desk. STUN only helps when they are on different networks; on one Wi-Fi it is not used. */
export const PHONE_RTC: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export type CameraLinkStatus = 'idle' | 'connecting' | 'live' | 'failed';

export interface SignalPayload { type?: string; sdp?: string; cid?: string; label?: string }
export interface Signal { kind: 'offer' | 'answer' | 'bye'; payload: SignalPayload }
export interface ReceivedSignal extends Signal { id: number }

// ---------------------------------------------------------------- phone pictures in this window

export interface PhoneSource { cid: string; label: string; stream: MediaStream | null; status: CameraLinkStatus }

let sources: PhoneSource[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setPhoneSource(cid: string, patch: Partial<Omit<PhoneSource, 'cid'>> | null) {
  const i = sources.findIndex((s) => s.cid === cid);
  if (patch === null) {
    if (i < 0) return;
    sources = sources.filter((s) => s.cid !== cid);
  } else if (i < 0) {
    sources = [...sources, { cid, label: patch.label || `Phone ${sources.length + 1}`, stream: patch.stream ?? null, status: patch.status ?? 'connecting' }];
  } else {
    sources = sources.map((s) => (s.cid === cid ? { ...s, ...patch, label: patch.label || s.label } : s));
  }
  notify();
}

export const getPhoneSources = () => sources;

export function usePhoneSources() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => sources, () => sources);
}

/** The stream for a source id ("phone:<cid>", or "phone" for the first phone that has a picture). */
export function phoneStreamFor(list: PhoneSource[], id?: string | null) {
  if (!id) return null;
  if (id === PHONE_CAMERA) return list.find((s) => s.stream)?.stream ?? null;
  return list.find((s) => phoneSourceId(s.cid) === id)?.stream ?? null;
}

/** Resolves once the connection has found its addresses (or after `ms`), so one message carries them all. */
export function gathered(pc: RTCPeerConnection, ms = 3000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const t = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(t);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    }
    function check() { if (pc.iceGatheringState === 'complete') done(); }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

// ---------------------------------------------------------------- desk: receive from the phones

/** Accepts each phone's offer, answers it, and publishes the pictures with setPhoneSource. */
export class DeskPhoneCameras {
  private pcs = new Map<string, RTCPeerConnection>();

  constructor(private send: (s: Signal) => void) {}

  async handle(sig: Signal) {
    const cid = sig.payload.cid || 'phone';
    if (sig.kind === 'bye') { this.drop(cid); return; }
    if (sig.kind !== 'offer' || !sig.payload.sdp) return;
    this.pcs.get(cid)?.close();
    if (typeof RTCPeerConnection === 'undefined') { setPhoneSource(cid, { status: 'failed', label: sig.payload.label }); return; }
    const pc = new RTCPeerConnection(PHONE_RTC);
    this.pcs.set(cid, pc);
    setPhoneSource(cid, { status: 'connecting', stream: null, label: sig.payload.label });
    const mine = () => this.pcs.get(cid) === pc;
    pc.ontrack = (e) => { if (mine()) setPhoneSource(cid, { stream: e.streams[0] || new MediaStream([e.track]) }); };
    pc.onconnectionstatechange = () => {
      if (!mine()) return;
      if (pc.connectionState === 'connected') setPhoneSource(cid, { status: 'live' });
      else if (pc.connectionState === 'failed') setPhoneSource(cid, { status: 'failed', stream: null });
      else if (pc.connectionState === 'disconnected') setPhoneSource(cid, { status: 'connecting' });
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: sig.payload.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      if (!mine() || !pc.localDescription) return;
      this.send({ kind: 'answer', payload: { type: 'answer', sdp: pc.localDescription.sdp, ...(sig.payload.cid ? { cid } : {}) } });
    } catch {
      if (mine()) { pc.close(); this.pcs.delete(cid); setPhoneSource(cid, { status: 'failed', stream: null }); }
    }
  }

  drop(cid: string) {
    this.pcs.get(cid)?.close();
    this.pcs.delete(cid);
    setPhoneSource(cid, null);
  }

  close() {
    [...this.pcs.keys()].forEach((cid) => this.drop(cid));
  }
}

// ---------------------------------------------------------------- desk → projector window

const RELAY = 'rlwm-phone-camera';

type RelayMessage =
  | { t: 'want'; from: string }
  | { t: 'offer'; to: string; cid: string; label: string; sdp: string }
  | { t: 'answer'; from: string; cid: string; sdp: string }
  | { t: 'ice'; to?: string; from?: string; cid: string; c: RTCIceCandidateInit }
  | { t: 'gone'; cid: string }
  | { t: 'none' }
  | { t: 'reset' };

/** Desk window: hands every phone picture to the other windows of this computer. Returns a stop function. */
export function startDeskRelay() {
  if (typeof BroadcastChannel === 'undefined' || typeof RTCPeerConnection === 'undefined') return () => {};
  const ch = new BroadcastChannel(RELAY);
  const receivers = new Set<string>();
  const peers = new Map<string, { pc: RTCPeerConnection; stream: MediaStream }>();
  const key = (to: string, cid: string) => `${to}|${cid}`;
  const post = (m: RelayMessage) => { try { ch.postMessage(m); } catch { /* closing */ } };

  const connect = async (to: string, src: PhoneSource) => {
    if (!src.stream) return;
    const k = key(to, src.cid);
    const old = peers.get(k);
    if (old?.stream === src.stream) return;
    old?.pc.close();
    const pc = new RTCPeerConnection();
    const stream = src.stream;
    peers.set(k, { pc, stream });
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => { if (e.candidate) post({ t: 'ice', to, cid: src.cid, c: e.candidate.toJSON() }); };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.localDescription) post({ t: 'offer', to, cid: src.cid, label: src.label, sdp: pc.localDescription.sdp });
    } catch { pc.close(); peers.delete(k); }
  };

  const sync = () => {
    const live = new Map(sources.filter((s) => s.stream).map((s) => [s.cid, s]));
    for (const [k, p] of peers) {
      const cid = k.slice(k.indexOf('|') + 1);
      if (live.get(cid)?.stream !== p.stream) { p.pc.close(); peers.delete(k); if (!live.has(cid)) post({ t: 'gone', cid }); }
    }
    receivers.forEach((to) => live.forEach((src) => connect(to, src)));
  };

  ch.onmessage = (e: MessageEvent<RelayMessage>) => {
    const m = e.data;
    if (m.t === 'want') {
      receivers.add(m.from);
      for (const [k, p] of peers) if (k.startsWith(`${m.from}|`)) { p.pc.close(); peers.delete(k); }
      sync();
    } else if (m.t === 'answer') peers.get(key(m.from, m.cid))?.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => {});
    else if (m.t === 'ice' && m.from) peers.get(key(m.from, m.cid))?.pc.addIceCandidate(m.c).catch(() => {});
  };
  listeners.add(sync);
  post({ t: 'reset' });
  return () => {
    listeners.delete(sync);
    peers.forEach((p) => p.pc.close());
    peers.clear();
    post({ t: 'none' });
    ch.close();
  };
}

/** Projector window: receives the phone pictures from the desk. Returns a stop function. */
export function startRelayReceiver() {
  if (typeof BroadcastChannel === 'undefined' || typeof RTCPeerConnection === 'undefined') return () => {};
  const id = Math.random().toString(36).slice(2, 10);
  const ch = new BroadcastChannel(RELAY);
  const pcs = new Map<string, RTCPeerConnection>();
  const post = (m: RelayMessage) => { try { ch.postMessage(m); } catch { /* closing */ } };
  const drop = (cid: string) => { pcs.get(cid)?.close(); pcs.delete(cid); setPhoneSource(cid, null); };
  const dropAll = () => [...pcs.keys()].forEach(drop);

  ch.onmessage = async (e: MessageEvent<RelayMessage>) => {
    const m = e.data;
    if (m.t === 'reset') { dropAll(); post({ t: 'want', from: id }); }
    else if (m.t === 'none') dropAll();
    else if (m.t === 'gone') drop(m.cid);
    else if (m.t === 'offer' && m.to === id) {
      pcs.get(m.cid)?.close();
      const pc = new RTCPeerConnection();
      pcs.set(m.cid, pc);
      const mine = () => pcs.get(m.cid) === pc;
      pc.ontrack = (ev) => { if (mine()) setPhoneSource(m.cid, { label: m.label, status: 'live', stream: ev.streams[0] || new MediaStream([ev.track]) }); };
      pc.onicecandidate = (ev) => { if (ev.candidate) post({ t: 'ice', from: id, cid: m.cid, c: ev.candidate.toJSON() }); };
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        if (pc.localDescription) post({ t: 'answer', from: id, cid: m.cid, sdp: pc.localDescription.sdp });
      } catch { if (mine()) drop(m.cid); }
    } else if (m.t === 'ice' && m.to === id) pcs.get(m.cid)?.addIceCandidate(m.c).catch(() => {});
  };
  post({ t: 'want', from: id });
  return () => { dropAll(); ch.close(); };
}

// ---------------------------------------------------------------- phone: send the camera

export type Facing = 'environment' | 'user';

export function phoneCameraError(e: unknown) {
  const name = (e as Error)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The camera is blocked. Allow the camera for this page in the browser settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'This phone has no camera the browser can use.';
  if (name === 'NotReadableError') return 'Another app is using the camera. Close it and try again.';
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') return 'This browser cannot send the camera. Use Chrome on Android or Safari on iPhone.';
  return (e as Error)?.message || 'The camera could not be opened.';
}

// Landscape (16:9) as the screens are; a phone held upright still sends upright, so the page asks to turn it.
const videoFor = (facing: Facing): MediaTrackConstraints => ({
  facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30 },
});

/** This phone's camera id on the link, kept while the page is open (and across a reload). */
export function phoneCameraId() {
  try {
    const saved = sessionStorage.getItem('rlwm-phone-camera-id');
    if (saved && /^[a-z0-9]{4,16}$/.test(saved)) return saved;
    const id = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    sessionStorage.setItem('rlwm-phone-camera-id', id);
    return id;
  } catch { return Math.random().toString(36).slice(2, 10).padEnd(8, '0'); }
}

/** Phone side: opens the camera, offers it to the desk, and applies the desk's answer. */
export class PhoneCameraSender {
  pc: RTCPeerConnection | null = null;
  stream: MediaStream | null = null;
  status: CameraLinkStatus = 'idle';
  readonly cid = phoneCameraId();

  constructor(private send: (s: Signal) => Promise<void>, private onChange: () => void) {}

  private set(s: CameraLinkStatus) { this.status = s; this.onChange(); }

  async start(facing: Facing, sound: boolean, label: string) {
    this.stop(false);
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error(phoneCameraError(null));
    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoFor(facing),
      audio: sound ? { echoCancellation: true, noiseSuppression: true } : false,
    });
    this.stream = stream;
    const pc = new RTCPeerConnection(PHONE_RTC);
    this.pc = pc;
    this.set('connecting');
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    // Keep the picture sharp on Wi-Fi: up to 4 Mbit/s for the camera.
    pc.getSenders().forEach((s) => {
      if (s.track?.kind !== 'video') return;
      const p = s.getParameters();
      p.encodings = [{ ...(p.encodings?.[0] || {}), maxBitrate: 4_000_000 }];
      s.setParameters(p).catch(() => {});
    });
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') this.set('live');
      else if (pc.connectionState === 'failed') this.set('failed');
      else if (pc.connectionState === 'disconnected') this.set('connecting');
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    if (this.pc !== pc || !pc.localDescription) return;
    await this.send({ kind: 'offer', payload: { type: 'offer', sdp: pc.localDescription.sdp, cid: this.cid, label: label.trim() || 'Phone camera' } });
    this.onChange();
  }

  async answer(sig: Signal) {
    const pc = this.pc;
    if (!pc || sig.kind !== 'answer' || !sig.payload.sdp || pc.signalingState !== 'have-local-offer') return;
    if (sig.payload.cid && sig.payload.cid !== this.cid) return; // another phone's answer
    try { await pc.setRemoteDescription({ type: 'answer', sdp: sig.payload.sdp }); } catch { this.set('failed'); }
  }

  /** Front or back camera without setting the link up again. */
  async switchCamera(facing: Facing) {
    if (!this.pc || !this.stream) return;
    const fresh = await navigator.mediaDevices.getUserMedia({ video: videoFor(facing) });
    const track = fresh.getVideoTracks()[0];
    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
    await sender?.replaceTrack(track);
    this.stream.getVideoTracks().forEach((t) => { t.stop(); this.stream?.removeTrack(t); });
    this.stream.addTrack(track);
    this.onChange();
  }

  stop(tellDesk = true) {
    const had = !!this.pc;
    this.pc?.close();
    this.pc = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (had && tellDesk) this.send({ kind: 'bye', payload: { cid: this.cid } }).catch(() => {});
    if (this.status !== 'idle') this.set('idle');
  }
}
