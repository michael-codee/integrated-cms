/**
 * A phone's camera as a live camera source for the screens.
 *
 * The phone (on the remote page) sends its camera to the control desk with WebRTC. Only the short
 * set-up messages (offer and answer) go through the server, with the remote's other traffic; the
 * picture itself goes straight from the phone to the media computer over the church Wi-Fi, or
 * through the internet when the two are on different networks.
 *
 * The desk then passes the picture on to the projector and stage windows on the same computer
 * through a second, local WebRTC link set up over a BroadcastChannel, so it reaches every screen
 * without going out of the computer again.
 */
import { useSyncExternalStore } from 'react';

/** The camera setting that means "the phone's camera" instead of a device on this computer. */
export const PHONE_CAMERA = 'phone';

/** For phone ↔ desk. STUN only helps when they are on different networks; on one Wi-Fi it is not used. */
export const PHONE_RTC: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export type CameraLinkStatus = 'idle' | 'connecting' | 'live' | 'failed';

export interface Signal { kind: 'offer' | 'answer' | 'bye'; payload: { type?: string; sdp?: string } }
export interface ReceivedSignal extends Signal { id: number }

// ---------------------------------------------------------------- the phone picture in this window

let current: MediaStream | null = null;
const listeners = new Set<() => void>();

export function setPhoneStream(s: MediaStream | null) {
  if (current === s) return;
  current = s;
  listeners.forEach((l) => l());
}

export function getPhoneStream() { return current; }

export function usePhoneStream() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => null);
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

// ---------------------------------------------------------------- desk: receive from the phone

/** Accepts the phone's offer, answers it, and publishes the picture with setPhoneStream. */
export class DeskPhoneCamera {
  private pc: RTCPeerConnection | null = null;
  status: CameraLinkStatus = 'idle';

  constructor(private send: (s: Signal) => void, private onStatus: (s: CameraLinkStatus) => void) {}

  private set(s: CameraLinkStatus) { this.status = s; this.onStatus(s); }

  async handle(sig: Signal) {
    if (sig.kind === 'bye') { this.close(); return; }
    if (sig.kind !== 'offer' || !sig.payload.sdp) return;
    this.close();
    if (typeof RTCPeerConnection === 'undefined') { this.set('failed'); return; }
    const pc = new RTCPeerConnection(PHONE_RTC);
    this.pc = pc;
    this.set('connecting');
    pc.ontrack = (e) => {
      if (this.pc !== pc) return;
      setPhoneStream(e.streams[0] || new MediaStream([e.track]));
    };
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') this.set('live');
      else if (pc.connectionState === 'failed') { setPhoneStream(null); this.set('failed'); }
      else if (pc.connectionState === 'disconnected') this.set('connecting');
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: sig.payload.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      if (this.pc !== pc || !pc.localDescription) return;
      this.send({ kind: 'answer', payload: { type: 'answer', sdp: pc.localDescription.sdp } });
    } catch {
      if (this.pc === pc) { this.close(); this.set('failed'); }
    }
  }

  close() {
    this.pc?.close();
    this.pc = null;
    setPhoneStream(null);
    if (this.status !== 'idle') this.set('idle');
  }
}

// ---------------------------------------------------------------- desk → projector and stage windows

const RELAY = 'rlwm-phone-camera';

type RelayMessage =
  | { t: 'want'; from: string }
  | { t: 'offer'; to: string; sdp: string }
  | { t: 'answer'; from: string; sdp: string }
  | { t: 'ice'; to?: string; from?: string; c: RTCIceCandidateInit }
  | { t: 'none' }
  | { t: 'reset' };

/** Desk window: hands the phone picture to the other windows of this computer. Returns a stop function. */
export function startDeskRelay() {
  if (typeof BroadcastChannel === 'undefined' || typeof RTCPeerConnection === 'undefined') return () => {};
  const ch = new BroadcastChannel(RELAY);
  const peers = new Map<string, RTCPeerConnection>();
  const post = (m: RelayMessage) => { try { ch.postMessage(m); } catch { /* closing */ } };
  const drop = () => { peers.forEach((pc) => pc.close()); peers.clear(); };

  const connect = async (id: string) => {
    peers.get(id)?.close();
    const stream = current;
    if (!stream) { post({ t: 'none' }); return; }
    const pc = new RTCPeerConnection();
    peers.set(id, pc);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => { if (e.candidate) post({ t: 'ice', to: id, c: e.candidate.toJSON() }); };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.localDescription) post({ t: 'offer', to: id, sdp: pc.localDescription.sdp });
    } catch { pc.close(); peers.delete(id); }
  };

  ch.onmessage = (e: MessageEvent<RelayMessage>) => {
    const m = e.data;
    if (m.t === 'want') connect(m.from);
    else if (m.t === 'answer') peers.get(m.from)?.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => {});
    else if (m.t === 'ice' && m.from) peers.get(m.from)?.addIceCandidate(m.c).catch(() => {});
  };
  const onChange = () => { drop(); post(current ? { t: 'reset' } : { t: 'none' }); };
  listeners.add(onChange);
  onChange();
  return () => { listeners.delete(onChange); drop(); post({ t: 'none' }); ch.close(); };
}

/** Projector or stage window: receives the phone picture from the desk. Returns a stop function. */
export function startRelayReceiver() {
  if (typeof BroadcastChannel === 'undefined' || typeof RTCPeerConnection === 'undefined') return () => {};
  const id = Math.random().toString(36).slice(2, 10);
  const ch = new BroadcastChannel(RELAY);
  let pc: RTCPeerConnection | null = null;
  const post = (m: RelayMessage) => { try { ch.postMessage(m); } catch { /* closing */ } };
  const stop = () => { pc?.close(); pc = null; setPhoneStream(null); };

  ch.onmessage = async (e: MessageEvent<RelayMessage>) => {
    const m = e.data;
    if (m.t === 'reset') post({ t: 'want', from: id });
    else if (m.t === 'none') stop();
    else if (m.t === 'offer' && m.to === id) {
      pc?.close();
      const conn = new RTCPeerConnection();
      pc = conn;
      conn.ontrack = (ev) => { if (pc === conn) setPhoneStream(ev.streams[0] || new MediaStream([ev.track])); };
      conn.onicecandidate = (ev) => { if (ev.candidate) post({ t: 'ice', from: id, c: ev.candidate.toJSON() }); };
      try {
        await conn.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        await conn.setLocalDescription(await conn.createAnswer());
        if (conn.localDescription) post({ t: 'answer', from: id, sdp: conn.localDescription.sdp });
      } catch { if (pc === conn) stop(); }
    } else if (m.t === 'ice' && m.to === id) pc?.addIceCandidate(m.c).catch(() => {});
  };
  post({ t: 'want', from: id });
  return () => { stop(); ch.close(); };
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

const videoFor = (facing: Facing): MediaTrackConstraints => ({ facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });

/** Phone side: opens the camera, offers it to the desk, and applies the desk's answer. */
export class PhoneCameraSender {
  pc: RTCPeerConnection | null = null;
  stream: MediaStream | null = null;
  status: CameraLinkStatus = 'idle';

  constructor(private send: (s: Signal) => Promise<void>, private onChange: () => void) {}

  private set(s: CameraLinkStatus) { this.status = s; this.onChange(); }

  async start(facing: Facing, sound: boolean) {
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
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'connected') this.set('live');
      else if (pc.connectionState === 'failed') this.set('failed');
      else if (pc.connectionState === 'disconnected') this.set('connecting');
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    if (this.pc !== pc || !pc.localDescription) return;
    await this.send({ kind: 'offer', payload: { type: 'offer', sdp: pc.localDescription.sdp } });
    this.onChange();
  }

  async answer(sig: Signal) {
    const pc = this.pc;
    if (!pc || sig.kind !== 'answer' || !sig.payload.sdp || pc.signalingState !== 'have-local-offer') return;
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
    if (had && tellDesk) this.send({ kind: 'bye', payload: {} }).catch(() => {});
    if (this.status !== 'idle') this.set('idle');
  }
}
