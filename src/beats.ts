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

/** Detected tempo is folded (doubled/halved) into this range. */
export const MIN_TEMPO_BPM = 90;
export const MAX_TEMPO_BPM = 180;
export const DEFAULT_BASS_END_INDEX = 8;
/** Longest PCM window used for tempo analysis (seconds), taken from the start of the audio. */
export const MAX_TEMPO_ANALYSIS_SECONDS = 90;
/** Band-pass (low pass then high pass) that isolates kick impulses before peak picking. */
const TEMPO_LOW_PASS_HZ = 150;
const TEMPO_HIGH_PASS_HZ = 100;
/** Biquad Q in dB, as in the Web Audio BiquadFilterNode. */
const TEMPO_FILTER_Q_DB = 1;
/** Audio is split into parts of this length; each part contributes its loudest sample as a peak. */
const TEMPO_PART_SECONDS = 0.5;
/** Each peak is compared with this many following peaks to build intervals. */
const TEMPO_INTERVAL_NEIGHBOURS = 9;
/** Peaks are moved left by this share of a beat to land on the start of the hit, not its maximum. */
const TEMPO_PEAK_LEFT_SHIFT_SHARE = 0.05;
/** Peaks whose beat offset is within this many seconds of the loudest peak's offset set the phase. */
const TEMPO_OFFSET_TOLERANCE_SEC = 0.05;
const SILENCE_THRESHOLD = 1e-4;

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

/** Signed distance from `value` to `reference` on a circle of length `period`, in [-period/2, period/2). */
const circularDiff = (value: number, reference: number, period: number): number =>
  wrapIntoPeriod(value - reference + period / 2, period) - period / 2;

type BiquadType = 'lowpass' | 'highpass';

/** Biquad filter with the Web Audio BiquadFilterNode (RBJ cookbook) coefficients. */
const biquadFilter = (
  samples: ArrayLike<number>,
  length: number,
  sampleRate: number,
  type: BiquadType,
  frequency: number,
  qDb: number,
): Float32Array => {
  const w0 = 2 * Math.PI * Math.min(frequency, sampleRate / 2 - 1) / sampleRate;
  const cosW0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.pow(10, qDb / 20));
  const a0 = 1 + alpha;
  const b1 = (type === 'lowpass' ? 1 - cosW0 : -(1 + cosW0)) / a0;
  const b0 = (type === 'lowpass' ? b1 / 2 : -b1 / 2);
  const b2 = b0;
  const a1 = (-2 * cosW0) / a0;
  const a2 = (1 - alpha) / a0;

  const out = new Float32Array(length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
};

interface Peak {
  position: number;
  volume: number;
}

/** Loudest sample of each part (`getVolume` picks how a sample is measured). */
const partPeaks = (
  data: Float32Array,
  partSize: number,
  getVolume: (sample: number) => number,
  positionShift = 0,
): Peak[] => {
  const peaks: Peak[] = [];
  for (let start = 0; start < data.length; start += partSize) {
    const end = Math.min(start + partSize, data.length);
    let max: Peak | null = null;
    for (let j = start; j < end; j++) {
      const volume = getVolume(data[j]);
      if (!max || volume > max.volume) {
        max = { position: j - positionShift, volume };
      }
    }
    if (max) {
      peaks.push(max);
    }
  }
  return peaks;
};

/** Loudest half of the per-part peaks, in playback order. */
const getLoudPeaks = (data: Float32Array, partSize: number): Peak[] => {
  const peaks = partPeaks(data, partSize, Math.abs)
    .sort((a, b) => b.volume - a.volume);
  return peaks
    .slice(0, Math.floor(peaks.length / 2))
    .filter(p => p.volume > SILENCE_THRESHOLD)
    .sort((a, b) => a.position - b.position);
};

const foldTempoBpm = (bpm: number): number => {
  let folded = bpm;
  while (folded <= MIN_TEMPO_BPM) {
    folded *= 2;
  }
  while (folded > MAX_TEMPO_BPM) {
    folded /= 2;
  }
  return folded;
};

/** Most frequent tempo among the intervals between each peak and its following neighbours. */
const getMostFrequentTempo = (peaks: Peak[], sampleRate: number): number | null => {
  const counts = new Map<number, number>();
  peaks.forEach((peak, index) => {
    for (let i = 1; index + i < peaks.length && i <= TEMPO_INTERVAL_NEIGHBOURS; i++) {
      const distance = peaks[index + i].position - peak.position;
      if (distance <= 0) {
        continue;
      }
      const tempo = Math.round(foldTempoBpm((60 * sampleRate) / distance));
      counts.set(tempo, (counts.get(tempo) ?? 0) + 1);
    }
  });
  let best: number | null = null;
  let bestCount = 0;
  counts.forEach((count, tempo) => {
    if (count > bestCount) {
      best = tempo;
      bestCount = count;
    }
  });
  return best;
};

/**
 * Beat offset in [0, beat) seconds: the loudest peak is taken as a strong beat, and the offsets
 * of peaks that agree with it (within `TEMPO_OFFSET_TOLERANCE_SEC`) are averaged.
 */
const getBeatOffsetSec = (data: Float32Array, partSize: number, sampleRate: number, bpm: number): number => {
  const beatSec = 60 / bpm;
  const shift = Math.round(beatSec * TEMPO_PEAK_LEFT_SHIFT_SHARE * sampleRate);
  const peaks = partPeaks(data, partSize, v => v, shift)
    .filter(p => p.volume > SILENCE_THRESHOLD)
    .sort((a, b) => b.volume - a.volume);
  if (peaks.length === 0) {
    return 0;
  }
  const refOffset = wrapIntoPeriod(peaks[0].position / sampleRate, beatSec);
  let diffSum = 0;
  let count = 0;
  for (const peak of peaks) {
    const diff = circularDiff(peak.position / sampleRate, refOffset, beatSec);
    if (Math.abs(diff) < TEMPO_OFFSET_TOLERANCE_SEC) {
      diffSum += diff;
      count++;
    }
  }
  return wrapIntoPeriod(refOffset + diffSum / count, beatSec);
};

/**
 * Estimates the track tempo and beat phase (after BeatDetect.js by Arthur Beaulieu):
 * band-pass the audio around the kick, take the loudest sample of every half second,
 * keep the loudest half of those peaks, and pick the most frequent tempo among the intervals
 * between neighbouring peaks. The beat phase comes from the loudest peak and the peaks aligned with it.
 */
export const estimateTempo = (
  samples: ArrayLike<number>,
  sampleRate: number,
  fps: number,
): TempoEstimate | null => {
  if (!samples || samples.length === 0 || !(sampleRate > 0) || !(fps > 0)) {
    return null;
  }

  const length = Math.min(samples.length, Math.max(1, Math.floor(sampleRate * MAX_TEMPO_ANALYSIS_SECONDS)));
  const lowPassed = biquadFilter(samples, length, sampleRate, 'lowpass', TEMPO_LOW_PASS_HZ, TEMPO_FILTER_Q_DB);
  const data = biquadFilter(lowPassed, length, sampleRate, 'highpass', TEMPO_HIGH_PASS_HZ, TEMPO_FILTER_Q_DB);
  const partSize = Math.max(1, Math.round(sampleRate * TEMPO_PART_SECONDS));

  const bpm = getMostFrequentTempo(getLoudPeaks(data, partSize), sampleRate);
  if (bpm === null) {
    return null;
  }

  const beatSec = 60 / bpm;
  const offsetSec = getBeatOffsetSec(data, partSize, sampleRate, bpm);
  const durationSec = length / sampleRate;
  const beatsSec: number[] = [];
  for (let t = offsetSec; t < durationSec; t += beatSec) {
    beatsSec.push(t);
  }

  const periodFrames = fps * beatSec;
  return {
    bpm,
    periodFrames,
    phaseFrame: wrapIntoPeriod(offsetSec * fps, periodFrames),
    ...(beatsSec.length > 0 ? { beatsSec } : {}),
  };
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
