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

export const estimateTempo = (
  spectrums: number[][],
  fps: number,
  options?: { bassEndIndex?: number },
): TempoEstimate | null => {
  if (!spectrums || spectrums.length === 0 || !(fps > 0)) {
    return null;
  }

  const bassEndIndex = options?.bassEndIndex ?? DEFAULT_BASS_END_INDEX;
  const n = spectrums.length;
  const energies = new Float64Array(n);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const e = frameBassEnergy(spectrums[i], bassEndIndex);
    energies[i] = e;
    sum += e;
    sumSq += e * e;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  if (!(variance > 1e-12)) {
    return null;
  }

  const lagMin = Math.max(1, Math.round(fps * 60 / MAX_TEMPO_BPM));
  const lagMax = Math.min(n - 2, Math.round(fps * 60 / MIN_TEMPO_BPM));
  if (lagMax < lagMin) {
    return null;
  }

  for (let i = 0; i < n; i++) {
    energies[i] -= mean;
  }

  const corr: number[] = [];
  for (let i = 0; i <= lagMax; i++) {
    corr.push(0);
  }
  let peakLag = lagMin;
  let peakCorr = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let acc = 0;
    const count = n - lag;
    for (let i = 0; i < count; i++) {
      acc += energies[i] * energies[i + lag];
    }
    const value = acc / count;
    corr[lag] = value;
    if (value > peakCorr) {
      peakCorr = value;
      peakLag = lag;
    }
  }
  if (!(peakCorr > 0)) {
    return null;
  }

  const candidateLags = [peakLag];
  const halfLag = Math.round(peakLag / 2);
  const twiceLag = peakLag * 2;
  if (halfLag >= lagMin && halfLag <= lagMax && candidateLags.indexOf(halfLag) === -1) {
    candidateLags.push(halfLag);
  }
  if (twiceLag >= lagMin && twiceLag <= lagMax && candidateLags.indexOf(twiceLag) === -1) {
    candidateLags.push(twiceLag);
  }

  const corrThreshold = peakCorr * 0.85;
  let bestLag = peakLag;
  let bestScore = -Infinity;
  for (let c = 0; c < candidateLags.length; c++) {
    const lag = candidateLags[c];
    const value = corr[lag];
    if (value < corrThreshold) {
      continue;
    }
    const bpmAtLag = 60 * fps / lag;
    const inPreferred =
      bpmAtLag >= PREFERRED_TEMPO_BPM_MIN && bpmAtLag <= PREFERRED_TEMPO_BPM_MAX;
    const score = value + (inPreferred ? peakCorr * 0.05 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let frac = 0;
  if (bestLag > lagMin && bestLag < lagMax) {
    const y0 = corr[bestLag - 1];
    const y1 = corr[bestLag];
    const y2 = corr[bestLag + 1];
    const denom = 2 * (2 * y1 - y0 - y2);
    if (Math.abs(denom) > 1e-12) {
      frac = (y0 - y2) / denom;
      if (frac > 0.5) {
        frac = 0.5;
      } else if (frac < -0.5) {
        frac = -0.5;
      }
    }
  }

  const interpLag = bestLag + frac;
  const bpm = 60 * fps / interpLag;
  if (bpm < MIN_TEMPO_BPM * 0.9 || bpm > MAX_TEMPO_BPM * 1.1) {
    return null;
  }

  const periodFrames = interpLag;
  const phaseMax = Math.max(1, Math.round(periodFrames));
  const phaseWindow = Math.min(n, Math.max(phaseMax * 4, Math.round(fps * 2)));
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  for (let offset = 0; offset < phaseMax; offset++) {
    let score = 0;
    let count = 0;
    for (let k = 0; ; k++) {
      const i = Math.round(offset + k * periodFrames);
      if (i >= phaseWindow) {
        break;
      }
      if (i >= 0) {
        score += energies[i] + mean;
        count++;
      }
    }
    const avg = count > 0 ? score / count : 0;
    if (avg > bestPhaseScore) {
      bestPhaseScore = avg;
      bestPhase = offset;
    }
  }

  return {
    bpm,
    periodFrames,
    phaseFrame: bestPhase,
  };
};

export const beatGridFrameIndices = (
  tempo: Pick<TempoEstimate, 'periodFrames' | 'phaseFrame'>,
  totalFrames: number,
): number[] => {
  const period = tempo.periodFrames;
  if (!(period > 0) || totalFrames <= 1) {
    return [];
  }
  const frames: number[] = [];
  const nStart = tempo.phaseFrame > 0 ? 0 : 1;
  for (let n = nStart; ; n++) {
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
