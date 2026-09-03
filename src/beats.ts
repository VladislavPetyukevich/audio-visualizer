import MusicTempo from 'music-tempo';

export interface BeatInfo {
  isBeat: boolean;
  intensity: number;
  energy: number;
  threshold: number;
}

export interface BeatDetectorOptions {
  /** Number of past frames to average for adaptive threshold (~1.5s by default) */
  historySize?: number;
  /** Energy must exceed average * this multiplier to trigger a beat */
  thresholdMultiplier?: number;
  /** How fast the beat intensity fades between beats (0-1, lower = faster fade) */
  decayRate?: number;
  /** Minimum frames between consecutive beats (~150ms by default) */
  cooldownFrames?: number;
  /** How many low-frequency spectrum bands contribute to energy (sub-bass + bass) */
  bassEndIndex?: number;
}

export interface TempoEstimate {
  bpm: number;
  periodFrames: number;
  phaseFrame: number;
}

export const MIN_TEMPO_BPM = 70;
export const MAX_TEMPO_BPM = 180;
export const PREFERRED_TEMPO_BPM_MIN = 90;
export const PREFERRED_TEMPO_BPM_MAX = 160;
export const DEFAULT_BASS_END_INDEX = 8;
/** Longest PCM window passed to music-tempo (seconds), taken from the start of the audio. */
export const MAX_TEMPO_ANALYSIS_SECONDS = 90;
const TEMPO_TIME_STEP = 0.01;

export const frameBassEnergy = (spectrum: number[], bassEndIndex = DEFAULT_BASS_END_INDEX): number => {
  const end = Math.min(bassEndIndex, spectrum.length);
  if (end <= 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < end; i++) {
    const v = spectrum[i];
    sum += v * v;
  }
  return sum / end;
};

export const createBeatDetector = (fps: number, options?: BeatDetectorOptions) => {
  const historySize = options?.historySize ?? Math.round(fps * 1.5);
  const thresholdMultiplier = options?.thresholdMultiplier ?? 1.4;
  const decayRate = options?.decayRate ?? 0.85;
  const cooldownFrames = options?.cooldownFrames ?? Math.round(fps * 0.15);
  const bassEndIndex = options?.bassEndIndex ?? DEFAULT_BASS_END_INDEX;

  const energyHistory: number[] = [];
  let framesSinceLastBeat = cooldownFrames;
  let decayingIntensity = 0;

  return (spectrum: number[]): BeatInfo => {
    const energy = frameBassEnergy(spectrum, bassEndIndex);

    energyHistory.push(energy);
    if (energyHistory.length > historySize) {
      energyHistory.shift();
    }

    const avgEnergy = energyHistory.reduce((sum, e) => sum + e, 0) / energyHistory.length;
    const variance = energyHistory.reduce((sum, e) => sum + (e - avgEnergy) ** 2, 0) / energyHistory.length;
    const stdDev = Math.sqrt(variance);

    const threshold = avgEnergy + stdDev * thresholdMultiplier;

    framesSinceLastBeat++;

    const hasEnoughHistory = energyHistory.length >= Math.round(historySize / 3);
    const isAboveThreshold = energy > threshold && hasEnoughHistory;
    const isCooldownOver = framesSinceLastBeat >= cooldownFrames;
    const isBeat = isAboveThreshold && isCooldownOver;

    if (isBeat) {
      framesSinceLastBeat = 0;
      decayingIntensity = Math.min(1, (energy - threshold) / (stdDev + 1e-6));
    } else {
      decayingIntensity *= decayRate;
    }

    return {
      isBeat,
      intensity: decayingIntensity,
      energy,
      threshold,
    };
  };
};

const foldTempoBpm = (bpm: number): number => {
  let folded = bpm;
  while (folded > MAX_TEMPO_BPM && folded / 2 >= MIN_TEMPO_BPM) {
    folded /= 2;
  }
  while (folded < MIN_TEMPO_BPM && folded * 2 <= MAX_TEMPO_BPM) {
    folded *= 2;
  }
  return folded;
};

const samplesToArray = (samples: ArrayLike<number>, maxLength: number): number[] => {
  const n = Math.min(samples.length, maxLength);
  if (Array.isArray(samples) && n === samples.length) {
    return samples;
  }
  const audioData = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    audioData[i] = samples[i];
  }
  return audioData;
};

export const estimateTempo = (
  samples: ArrayLike<number>,
  sampleRate: number,
  fps: number,
): TempoEstimate | null => {
  if (!samples || samples.length === 0 || !(sampleRate > 0) || !(fps > 0)) {
    return null;
  }

  const maxSamples = Math.max(1, Math.floor(sampleRate * MAX_TEMPO_ANALYSIS_SECONDS));
  const audioData = samplesToArray(samples, maxSamples);
  const hopSize = Math.max(1, Math.round(sampleRate * TEMPO_TIME_STEP));

  try {
    const mt = new MusicTempo(audioData, {
      hopSize,
      timeStep: TEMPO_TIME_STEP,
      minBeatInterval: 60 / MAX_TEMPO_BPM,
      maxBeatInterval: 60 / MIN_TEMPO_BPM,
    });
    const beatInterval = Number(mt.beatInterval);
    let bpm = Number(mt.tempo);
    if (!(bpm > 0) && beatInterval > 0) {
      bpm = 60 / beatInterval;
    }
    if (!(bpm > 0)) {
      return null;
    }

    bpm = foldTempoBpm(bpm);
    if (bpm < MIN_TEMPO_BPM * 0.9 || bpm > MAX_TEMPO_BPM * 1.1) {
      return null;
    }

    const periodFrames = fps * 60 / bpm;
    const periodInt = Math.max(1, Math.round(periodFrames));
    const firstBeatSec = mt.beats && mt.beats.length > 0 ? Number(mt.beats[0]) : 0;
    let phaseFrame = 0;
    if (firstBeatSec >= 0 && isFinite(firstBeatSec)) {
      phaseFrame = Math.round(firstBeatSec * fps);
      phaseFrame = ((phaseFrame % periodInt) + periodInt) % periodInt;
    }

    return {
      bpm: Math.round(bpm),
      periodFrames,
      phaseFrame,
    };
  } catch {
    return null;
  }
};

export const shiftTempoPhase = (
  tempo: TempoEstimate,
  startFrame: number,
): TempoEstimate => {
  const period = tempo.periodFrames;
  if (!(period > 0) || startFrame === 0) {
    return tempo;
  }
  const periodInt = Math.max(1, Math.round(period));
  const phase = ((Math.round(tempo.phaseFrame) - startFrame) % periodInt + periodInt) % periodInt;
  return {
    bpm: tempo.bpm,
    periodFrames: period,
    phaseFrame: phase,
  };
};

export const beatGridFrameIndices = (
  tempo: Pick<TempoEstimate, 'periodFrames' | 'phaseFrame'>,
  totalFrames: number,
  stride = 1,
): number[] => {
  const period = tempo.periodFrames;
  const step = Math.max(1, Math.round(stride));
  if (!(period > 0) || totalFrames <= 1) {
    return [];
  }
  const frames: number[] = [];
  const nStart = tempo.phaseFrame > 0 ? 0 : 1;
  for (let n = nStart; ; n += step) {
    const frame = Math.round(tempo.phaseFrame + n * period);
    if (frame >= totalFrames) {
      break;
    }
    if (frame > 0) {
      frames.push(frame);
    }
  }
  return frames;
};
