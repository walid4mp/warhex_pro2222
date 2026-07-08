/**
 * voice.js — Production WebRTC Voice Chat.
 *
 * Features:
 *  • STUN + TURN (Metered Open Relay) with rotating credentials
 *  • Echo cancellation + noise suppression + auto gain
 *  • Mute / unmute mic
 *  • Speaker mute
 *  • Speaking detection (audio level analysis)
 *  • Auto-reconnect on ICE failure
 *  • Mesh topology for room voice
 */
const VoiceChat = {
  socket: null,
  localStream: null,
  peers: {},         // socketId → { pc, audioEl, analyser, speaking }
  active: false,
  muted: false,       // mic muted
  speakerMuted: false,
  iceServers: [],
  speakingCallback: null,

  async init(socket) {
    this.socket = socket;
    try {
      const r = await fetch('/api/ice-servers?userId=' + (socket.id || 'guest'));
      const data = await r.json();
      this.iceServers = data.iceServers || [];
      console.log('[voice] ICE servers:', this.iceServers.length);
    } catch (e) {
      console.warn('[voice] Failed to fetch ICE servers:', e);
      this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    socket.on('rtc:signal', async ({ from, data }) => {
      await this.handleSignal(from, data);
    });

    socket.on('rtc:user-joined', ({ socketId }) => {
      console.log('[voice] User joined voice:', socketId);
      if (this.active && socketId !== this.socket.id) {
        this.ensurePeer(socketId, this.socket.id < socketId);
      }
    });

    socket.on('rtc:user-left', ({ socketId }) => {
      this.removePeer(socketId);
    });
  },

  async start() {
    if (this.active) return true;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      this.active = true;
      this.muted = false;
      this.socket.emit('rtc:join');
      console.log('[voice] Microphone started');
      return true;
    } catch (e) {
      console.error('[voice] Failed to start mic:', e);
      throw e;
    }
  },

  stop() {
    Object.values(this.peers).forEach(p => {
      try { p.pc.close(); } catch {}
      if (p.audioEl) p.audioEl.remove();
    });
    this.peers = {};
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.active = false;
    this.muted = false;
    console.log('[voice] Voice chat stopped');
  },

  syncPeers(playerIds) {
    if (!this.active) return;
    const ids = (playerIds || []).filter(id => id !== this.socket.id);
    ids.forEach(id => { if (!this.peers[id]) this.ensurePeer(id, this.socket.id < id); });
    Object.keys(this.peers).forEach(id => {
      if (!ids.includes(id)) this.removePeer(id);
    });
  },

  ensurePeer(peerId, initiate) {
    if (this.peers[peerId]) return this.peers[peerId];
    console.log('[voice] Creating peer connection:', peerId);

    const config = { iceServers: this.iceServers, iceTransportPolicy: 'all' };
    const pc = new RTCPeerConnection(config);

    this.localStream?.getTracks().forEach(track => {
      pc.addTrack(track, this.localStream);
    });

    pc.onicecandidate = e => {
      if (e.candidate) {
        this.socket.emit('rtc:signal', { to: peerId, data: { candidate: e.candidate } });
      }
    };

    pc.ontrack = e => {
      let audio = document.getElementById('audio-' + peerId);
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'audio-' + peerId;
        audio.autoplay = true;
        audio.dataset.peer = 'true';
        document.body.appendChild(audio);
      }
      audio.srcObject = e.streams[0];
      audio.muted = this.speakerMuted;

      // Audio level analysis for speaking detection
      try {
        const ac = new AudioContext();
        const src = ac.createMediaStreamSource(e.streams[0]);
        const analyser = ac.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        this.peers[peerId].analyser = analyser;
        this.peers[peerId].audioCtx = ac;
      } catch {}
    };

    pc.onconnectionstatechange = () => {
      console.log(`[voice] ${peerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        console.log('[voice] ICE failed, attempting restart...');
        pc.restartIce();
      }
      if (pc.connectionState === 'disconnected') {
        setTimeout(() => {
          if (this.peers[peerId] && pc.connectionState === 'disconnected') {
            console.log('[voice] Reconnecting peer:', peerId);
            pc.restartIce();
          }
        }, 3000);
      }
    };

    this.peers[peerId] = { pc, audioEl: null, analyser: null, speaking: false };

    if (initiate) this.createOffer(peerId);
    return this.peers[peerId];
  },

  async createOffer(peerId) {
    const peer = this.ensurePeer(peerId, false);
    try {
      const offer = await peer.pc.createOffer({ offerToReceiveAudio: true });
      await peer.pc.setLocalDescription(offer);
      this.socket.emit('rtc:signal', { to: peerId, data: { description: peer.pc.localDescription } });
    } catch (e) { console.error('[voice] Offer failed:', e); }
  },

  async handleSignal(from, data) {
    if (!this.active) return;
    const peer = this.ensurePeer(from, false);
    try {
      if (data.description) {
        await peer.pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          this.socket.emit('rtc:signal', { to: from, data: { description: peer.pc.localDescription } });
        }
      }
      if (data.candidate) {
        await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (e) { console.error('[voice] Signal error:', e); }
  },

  removePeer(peerId) {
    const peer = this.peers[peerId];
    if (!peer) return;
    try { peer.pc.close(); } catch {}
    if (peer.audioCtx) try { peer.audioCtx.close(); } catch {}
    const audio = document.getElementById('audio-' + peerId);
    if (audio) audio.remove();
    delete this.peers[peerId];
  },

  toggleMute() {
    if (!this.localStream) return false;
    this.muted = !this.muted;
    this.localStream.getAudioTracks().forEach(t => t.enabled = !this.muted);
    return this.muted;
  },

  toggleSpeakerMute() {
    this.speakerMuted = !this.speakerMuted;
    document.querySelectorAll('audio[data-peer]').forEach(a => a.muted = this.speakerMuted);
    return this.speakerMuted;
  },

  // Check if any remote peer is speaking
  checkSpeaking() {
    let someoneSpeaking = false;
    for (const [id, peer] of Object.entries(this.peers)) {
      if (!peer.analyser) continue;
      const data = new Uint8Array(peer.analyser.frequencyBinCount);
      peer.analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      peer.speaking = avg > 20;
      if (peer.speaking) someoneSpeaking = true;
    }
    return someoneSpeaking;
  },

  isActive() { return this.active; },
};

if (typeof window !== 'undefined') window.VoiceChat = VoiceChat;
