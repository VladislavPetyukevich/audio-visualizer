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
  /** Beat times in seconds from the start of the analyzed audio. */
  beatsSec?: number[];
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

const wrapIntoPeriod = (value: number, period: number): number => {
  if (!(period > 0) || !isFinite(value)) {
    return 0;
  }
  let wrapped = value - period * Math.floor(value / period);
  if (wrapped < 0) {
    wrapped += period;
  }
  if (wrapped >= period) {
    wrapped = 0;
  }
  return wrapped;
};

const circularMeanPhase = (frames: number[], period: number): number => {
  if (!(period > 0) || frames.length === 0) {
    return 0;
  }
  let sinSum = 0;
  let cosSum = 0;
  for (const frame of frames) {
    const angle = (2 * Math.PI * frame) / period;
    sinSum += Math.sin(angle);
    cosSum += Math.cos(angle);
  }
  const phase = Math.atan2(sinSum, cosSum) * period / (2 * Math.PI);
  return wrapIntoPeriod(phase, period);
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
    const beatsSec = (mt.beats ?? [])
      .map(t => Number(t))
      .filter(t => t >= 0 && isFinite(t));
    const beatFrames = beatsSec.map(t => t * fps);
    const phaseFrame = beatFrames.length > 0
      ? wrapIntoPeriod(circularMeanPhase(beatFrames, periodFrames), periodFrames)
      : 0;

    return {
      bpm: Math.round(bpm),
      periodFrames,
      phaseFrame,
      ...(beatsSec.length > 0 ? { beatsSec } : {}),
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
  return {
    ...tempo,
    phaseFrame: wrapIntoPeriod(tempo.phaseFrame - startFrame, period),
  };
};

/** Beat-grid phase for a later audio window, using in-window beat times when available. */
export const tempoForWindow = (
  tempo: TempoEstimate,
  startFrame: number,
  fps: number,
  windowFrames?: number,
  localOnsetFrames?: number[],
): TempoEstimate => {
  const period = tempo.periodFrames;
  if (!(period > 0) || !(fps > 0)) {
    return tempo;
  }
  const startSec = startFrame / fps;
  const endSec = windowFrames != null && windowFrames >= 0
    ? (startFrame + windowFrames) / fps
    : Number.POSITIVE_INFINITY;
  const inWindow = (tempo.beatsSec ?? []).filter(t => t >= startSec && t < endSec);
  if (inWindow.length > 0) {
    const localFrames = inWindow.map(t => (t - startSec) * fps);
    return {
      ...tempo,
      phaseFrame: wrapIntoPeriod(circularMeanPhase(localFrames, period), period),
    };
  }
  const onsets = (localOnsetFrames ?? []).filter(frame =>
    frame > 0 && (windowFrames == null || frame < windowFrames),
  );
  if (onsets.length > 0) {
    return {
      ...tempo,
      phaseFrame: wrapIntoPeriod(circularMeanPhase(onsets, period), period),
    };
  }
  return shiftTempoPhase(tempo, startFrame);
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
