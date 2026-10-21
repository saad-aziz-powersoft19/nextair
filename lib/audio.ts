const MASTER_VOLUME = 0.45;

interface OneShot {
  source: AudioScheduledSourceNode;
  gainNode: GainNode;
}

interface AirAmbienceNodes {
  noise: AudioBufferSourceNode;
  lowpass: BiquadFilterNode;
  oscA: OscillatorNode;
  oscB: OscillatorNode;
  oscGain: GainNode;
  gain: GainNode;
  lfo: OscillatorNode;
}

class FlightAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private airNodes: AirAmbienceNodes | null = null;
  private oneShots: OneShot[] = [];
  private muted = false;
  private paused = false;

  get isMuted(): boolean {
    return this.muted;
  }

  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyMasterGain();
  }

  playTakeoff(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;

    const spoolNoise = ctx.createBufferSource();
    spoolNoise.buffer = this.getNoiseBuffer(ctx);
    spoolNoise.loop = true;

    const spoolFilter = ctx.createBiquadFilter();
    spoolFilter.type = 'bandpass';
    spoolFilter.Q.value = 1.1;
    spoolFilter.frequency.setValueAtTime(180, now);
    spoolFilter.frequency.exponentialRampToValueAtTime(1400, now + 4.5);

    const spoolGain = ctx.createGain();
    spoolGain.gain.setValueAtTime(0.0001, now);
    spoolGain.gain.linearRampToValueAtTime(0.5, now + 2);
    spoolGain.gain.setValueAtTime(0.5, now + 4.5);
    spoolGain.gain.linearRampToValueAtTime(0.0001, now + 7.5);

    spoolNoise.connect(spoolFilter);
    spoolFilter.connect(spoolGain);
    spoolGain.connect(this.masterGain);
    spoolNoise.start(now);
    spoolNoise.stop(now + 8);
    this.trackOneShot(spoolNoise, spoolGain);

    const rumble = ctx.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.setValueAtTime(42, now);
    rumble.frequency.linearRampToValueAtTime(76, now + 5);

    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 160;

    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.linearRampToValueAtTime(0.34, now + 1.5);
    rumbleGain.gain.setValueAtTime(0.34, now + 4.5);
    rumbleGain.gain.linearRampToValueAtTime(0.0001, now + 7.5);

    rumble.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(this.masterGain);
    rumble.start(now);
    rumble.stop(now + 8);
    this.trackOneShot(rumble, rumbleGain);
  }

  startAirAmbience(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.airNodes) return;

    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 420;
    lowpass.Q.value = 0.8;

    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    noise.loop = true;

    const oscA = ctx.createOscillator();
    oscA.type = 'sine';
    oscA.frequency.value = 62;

    const oscB = ctx.createOscillator();
    oscB.type = 'triangle';
    oscB.frequency.value = 98;

    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.22;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.16;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 30;

    noise.connect(lowpass);
    lowpass.connect(gain);
    oscA.connect(oscGain);
    oscB.connect(oscGain);
    oscGain.connect(gain);
    gain.connect(this.masterGain);

    lfo.connect(lfoGain);
    lfoGain.connect(lowpass.frequency);

    noise.start(now);
    oscA.start(now);
    oscB.start(now);
    lfo.start(now);

    this.airNodes = { noise, lowpass, oscA, oscB, oscGain, gain, lfo };
  }

  updateAirAmbience(speedKmh: number, altitudeFt: number): void {
    if (!this.ctx || !this.airNodes) return;

    const now = this.ctx.currentTime;
    const speedFactor = Math.min(1, Math.max(0, speedKmh / 950));
    const altitudeFactor = Math.min(1, Math.max(0, altitudeFt / 40000));

    const targetGain = 0.14 + speedFactor * 0.16 - altitudeFactor * 0.03;
    const targetCutoff = 380 + speedFactor * 520;
    const targetOscA = 58 + speedFactor * 16;
    const targetOscB = 92 + speedFactor * 22;

    this.airNodes.gain.gain.setTargetAtTime(targetGain, now, 0.6);
    this.airNodes.lowpass.frequency.setTargetAtTime(targetCutoff, now, 0.6);
    this.airNodes.oscA.frequency.setTargetAtTime(targetOscA, now, 0.6);
    this.airNodes.oscB.frequency.setTargetAtTime(targetOscB, now, 0.6);
  }

  playLanding(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    this.stopAirAmbience(0.6);

    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(110, now);
    thud.frequency.exponentialRampToValueAtTime(38, now + 0.45);

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.0001, now);
    thudGain.gain.exponentialRampToValueAtTime(0.7, now + 0.03);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);

    thud.connect(thudGain);
    thudGain.connect(this.masterGain);
    thud.start(now);
    thud.stop(now + 1);
    this.trackOneShot(thud, thudGain);

    const squeal = ctx.createBufferSource();
    squeal.buffer = this.getNoiseBuffer(ctx);
    squeal.loop = true;

    const squealFilter = ctx.createBiquadFilter();
    squealFilter.type = 'bandpass';
    squealFilter.frequency.setValueAtTime(2600, now);
    squealFilter.Q.value = 8;

    const squealGain = ctx.createGain();
    squealGain.gain.setValueAtTime(0.0001, now);
    squealGain.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
    squealGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);

    squeal.connect(squealFilter);
    squealFilter.connect(squealGain);
    squealGain.connect(this.masterGain);
    squeal.start(now);
    squeal.stop(now + 0.9);
    this.trackOneShot(squeal, squealGain);

    const reverse = ctx.createBufferSource();
    reverse.buffer = this.getNoiseBuffer(ctx);
    reverse.loop = true;

    const reverseFilter = ctx.createBiquadFilter();
    reverseFilter.type = 'lowpass';
    reverseFilter.frequency.setValueAtTime(300, now);
    reverseFilter.frequency.linearRampToValueAtTime(950, now + 1.4);

    const reverseGain = ctx.createGain();
    reverseGain.gain.setValueAtTime(0.0001, now);
    reverseGain.gain.linearRampToValueAtTime(0.38, now + 1.2);
    reverseGain.gain.linearRampToValueAtTime(0.0001, now + 4.8);

    reverse.connect(reverseFilter);
    reverseFilter.connect(reverseGain);
    reverseGain.connect(this.masterGain);
    reverse.start(now);
    reverse.stop(now + 5);
    this.trackOneShot(reverse, reverseGain);
  }

  stopAll(): void {
    this.stopAirAmbience(0.35);

    const ctx = this.ctx;
    if (!ctx) return;

    const now = ctx.currentTime;
    for (const oneShot of this.oneShots) {
      try {
        oneShot.gainNode.gain.cancelScheduledValues(now);
        oneShot.gainNode.gain.setTargetAtTime(0.0001, now, 0.1);
        oneShot.source.stop(now + 0.5);
      } catch {
        continue;
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const ContextCtor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!ContextCtor) return null;

      this.ctx = new ContextCtor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.targetVolume();
      this.masterGain.connect(this.ctx.destination);
    }

    return this.ctx;
  }

  private targetVolume(): number {
    return this.muted || this.paused ? 0.0001 : MASTER_VOLUME;
  }

  private applyMasterGain(): void {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(
      this.targetVolume(),
      this.ctx.currentTime,
      0.15
    );
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer || this.noiseBuffer.sampleRate !== ctx.sampleRate) {
      const length = Math.floor(ctx.sampleRate * 2);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  stopAirAmbience(fadeSeconds = 0.4): void {
    const ctx = this.ctx;
    const nodes = this.airNodes;
    if (!ctx || !nodes) return;

    this.airNodes = null;
    const now = ctx.currentTime;
    nodes.gain.gain.cancelScheduledValues(now);
    nodes.gain.gain.setTargetAtTime(0.0001, now, Math.max(0.05, fadeSeconds / 3));

    const stopTime = now + fadeSeconds + 0.6;
    nodes.noise.stop(stopTime);
    nodes.oscA.stop(stopTime);
    nodes.oscB.stop(stopTime);
    nodes.lfo.stop(stopTime);
  }

  private trackOneShot(source: AudioScheduledSourceNode, gainNode: GainNode): void {
    const entry: OneShot = { source, gainNode };
    this.oneShots.push(entry);
    source.onended = () => {
      this.oneShots = this.oneShots.filter((item) => item !== entry);
    };
  }
}

export const flightAudio = new FlightAudioEngine();
