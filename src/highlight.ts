/** Output length when `audio.autoHighlight` is true (seconds). */

import { waitForEventLoop } from "./waitForEventLoop";

export const HIGHLIGHT_DURATION_SEC = 15;

export interface BeatFrameEvent {
  frameIndex: number;
  intensity: number;
}

function frameEnergy(spectrum: number[]): number {
  let s = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const v = spectrum[i];
    s += v * v;
  }
  return s;
}

/**
 * Chooses the fixed-length window whose frames have the highest summed spectral energy
 * (typical chorus / drop vs a single loud intro transient).
 */
async function findBestHighlightStart(
  spectrums: number[][],
  totalFrames: number,
  windowFrames: number,
): Promise<number> {
  if (totalFrames <= windowFrames) {
    return 0;
  }

  const energies = new Float64Array(totalFrames);
  let minE = Infinity;
  let maxE = -Infinity;
  for (let i = 0; i < totalFrames; i++) {
    const e = frameEnergy(spectrums[i] ?? []);
    energies[i] = e;
    if (e < minE) {
      minE = e;
    }
    if (e > maxE) {
      maxE = e;
    }
    await waitForEventLoop();
  }

  if (maxE <= minE) {
    return Math.floor((totalFrames - windowFrames) / 2);
  }

  const prefix = new Float64Array(totalFrames + 1);
  for (let i = 0; i < totalFrames; i++) {
    prefix[i + 1] = prefix[i] + energies[i];
    await waitForEventLoop();
  }

  let bestStart = 0;
  let bestScore = -Infinity;
  const maxStart = totalFrames - windowFrames;
  for (let start = 0; start <= maxStart; start++) {
    const score = prefix[start + windowFrames] - prefix[start];
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
    await waitForEventLoop();
  }

  return bestStart;
}

/**
 * Picks a 15s window with the highest summed spectral energy across that span.
 * Slices spectrums and remaps beat indices into the window.
 */
export async function computeHighlightSlice(
  fps: number,
  totalFrames: number,
  spectrums: number[][],
  beatEvents: BeatFrameEvent[],
): Promise<{
  startFrame: number;
  highlightFrames: number;
  spectrums: number[][];
  beatFrameIndices: number[];
  audioSeekSeconds: number;
  audioDurationSeconds: number;
}> {
  const highlightFramesTarget = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);

  if (totalFrames <= 0) {
    return {
      startFrame: 0,
      highlightFrames: 0,
      spectrums: [],
      beatFrameIndices: [],
      audioSeekSeconds: 0,
      audioDurationSeconds: 0,
    };
  }

  if (totalFrames <= highlightFramesTarget) {
    return {
      startFrame: 0,
      highlightFrames: totalFrames,
      spectrums: spectrums.slice(),
      beatFrameIndices: beatEvents.map(b => b.frameIndex).sort((a, b) => a - b),
      audioSeekSeconds: 0,
      audioDurationSeconds: totalFrames / fps,
    };
  }

  const highlightFrames = highlightFramesTarget;
  const startFrame = await findBestHighlightStart(spectrums, totalFrames, highlightFrames);
  const sliced = spectrums.slice(startFrame, startFrame + highlightFrames);
  const beatFrameIndices = beatEvents
    .map(b => b.frameIndex)
    .filter(i => i >= startFrame && i < startFrame + highlightFrames)
    .map(i => i - startFrame)
    .sort((a, b) => a - b);

  return {
    startFrame,
    highlightFrames,
    spectrums: sliced,
    beatFrameIndices,
    audioSeekSeconds: startFrame / fps,
    audioDurationSeconds: highlightFrames / fps,
  };
}
