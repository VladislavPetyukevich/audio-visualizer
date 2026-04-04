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

export const createBeatDetector = (fps: number, options?: BeatDetectorOptions) => {
  const historySize = options?.historySize ?? Math.round(fps * 1.5);
  const thresholdMultiplier = options?.thresholdMultiplier ?? 1.4;
  const decayRate = options?.decayRate ?? 0.85;
  const cooldownFrames = options?.cooldownFrames ?? Math.round(fps * 0.15);
  const bassEndIndex = options?.bassEndIndex ?? 8;

  const energyHistory: number[] = [];
  let framesSinceLastBeat = cooldownFrames;
  let decayingIntensity = 0;

  return (spectrum: number[]): BeatInfo => {
    const bassSpectrum = spectrum.slice(0, Math.min(bassEndIndex, spectrum.length));
    const energy = bassSpectrum.reduce((sum, val) => sum + val * val, 0) / bassSpectrum.length;

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
