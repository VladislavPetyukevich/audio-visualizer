/** Output length per segment when `audio.autoHighlight` is true (seconds). */

import { waitForEventLoop } from "./waitForEventLoop";

export const HIGHLIGHT_DURATION_SEC = 15;

export interface BeatFrameEvent {
  frameIndex: number;
  intensity: number;
}

export interface HighlightAudioSegment {
  seekSeconds: number;
  durationSeconds: number;
}

/** One auto-highlight segment before concatenation (for separate output files). */
export interface HighlightRun {
  startFrame: number;
  highlightFrames: number;
  spectrums: number[][];
  beatFrameIndices: number[];
  audioSegment: HighlightAudioSegment;
}

function buildHighlightRun(
  fps: number,
  seg: { startFrame: number; highlightFrames: number },
  spectrums: number[][],
  beatEvents: BeatFrameEvent[],
): HighlightRun {
  const { startFrame, highlightFrames } = seg;
  const spectrumsSlice = spectrums.slice(startFrame, startFrame + highlightFrames);
  const beatFrameIndices = beatEvents
    .map(b => b.frameIndex)
    .filter(i => i >= startFrame && i < startFrame + highlightFrames)
    .map(i => i - startFrame)
    .sort((a, b) => a - b);
  return {
    startFrame,
    highlightFrames,
    spectrums: spectrumsSlice,
    beatFrameIndices,
    audioSegment: {
      seekSeconds: startFrame / fps,
      durationSeconds: highlightFrames / fps,
    },
  };
}

function frameEnergy(spectrum: number[]): number {
  let s = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const v = spectrum[i];
    s += v * v;
  }
  return s;
}

function rangesOverlap(
  aStart: number,
  aEndExclusive: number,
  ranges: Array<{ start: number; endExclusive: number }>,
): boolean {
  for (const r of ranges) {
    if (aStart < r.endExclusive && aEndExclusive > r.start) {
      return true;
    }
  }
  return false;
}

async function buildFrameEnergies(
  spectrums: number[][],
  totalFrames: number,
): Promise<Float64Array> {
  const energies = new Float64Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    energies[i] = frameEnergy(spectrums[i] ?? []);
    await waitForEventLoop();
  }
  return energies;
}

/**
 * Chooses the fixed-length window whose frames have the highest summed spectral energy
 * (typical chorus / drop vs a single loud intro transient).
 * Skips windows that overlap any excluded range.
 */
async function findBestHighlightStart(
  energies: Float64Array,
  totalFrames: number,
  windowFrames: number,
  excludeRanges: Array<{ start: number; endExclusive: number }>,
): Promise<number | null> {
  if (totalFrames <= windowFrames) {
    if (!rangesOverlap(0, totalFrames, excludeRanges)) {
      return 0;
    }
    return null;
  }

  let minE = Infinity;
  let maxE = -Infinity;
  for (let i = 0; i < totalFrames; i++) {
    const e = energies[i];
    if (e < minE) {
      minE = e;
    }
    if (e > maxE) {
      maxE = e;
    }
    await waitForEventLoop();
  }

  const prefix = new Float64Array(totalFrames + 1);
  for (let i = 0; i < totalFrames; i++) {
    prefix[i + 1] = prefix[i] + energies[i];
    await waitForEventLoop();
  }

  const maxStart = totalFrames - windowFrames;
  let bestStart: number | null = null;
  let bestScore = -Infinity;

  for (let start = 0; start <= maxStart; start++) {
    if (rangesOverlap(start, start + windowFrames, excludeRanges)) {
      await waitForEventLoop();
      continue;
    }
    const score = prefix[start + windowFrames] - prefix[start];
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
    await waitForEventLoop();
  }

  if (bestStart === null) {
    return null;
  }

  if (maxE <= minE) {
    const center = Math.floor((totalFrames - windowFrames) / 2);
    let bestDist = Infinity;
    let tieBreak: number | null = null;
    for (let start = 0; start <= maxStart; start++) {
      if (rangesOverlap(start, start + windowFrames, excludeRanges)) {
        await waitForEventLoop();
        continue;
      }
      const dist = Math.abs(start - center);
      if (dist < bestDist) {
        bestDist = dist;
        tieBreak = start;
      }
      await waitForEventLoop();
    }
    return tieBreak;
  }

  return bestStart;
}


/**
 * Picks up to `segmentCount` non-overlapping 15s windows with highest summed spectral energy each,
 * sorts them chronologically, concatenates spectrums, and remaps beat indices.
 */
export async function computeHighlightSlice(
  fps: number,
  totalFrames: number,
  spectrums: number[][],
  beatEvents: BeatFrameEvent[],
  segmentCount = 1,
): Promise<{
  startFrame: number;
  highlightFrames: number;
  spectrums: number[][];
  beatFrameIndices: number[];
  audioSeekSeconds: number;
  audioDurationSeconds: number;
  audioSegments: HighlightAudioSegment[];
  runs: HighlightRun[];
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
      audioSegments: [],
      runs: [],
    };
  }

  if (totalFrames <= highlightFramesTarget) {
    const audioSegments: HighlightAudioSegment[] = [
      {
        seekSeconds: 0,
        durationSeconds: totalFrames / fps,
      },
    ];
    const fullSeg = { startFrame: 0, highlightFrames: totalFrames };
    return {
      startFrame: 0,
      highlightFrames: totalFrames,
      spectrums: spectrums.slice(),
      beatFrameIndices: beatEvents.map(b => b.frameIndex).sort((a, b) => a - b),
      audioSeekSeconds: 0,
      audioDurationSeconds: totalFrames / fps,
      audioSegments,
      runs: [buildHighlightRun(fps, fullSeg, spectrums, beatEvents)],
    };
  }

  const highlightFrames = highlightFramesTarget;
  const energies = await buildFrameEnergies(spectrums, totalFrames);
  const excludeRanges: Array<{ start: number; endExclusive: number }> = [];
  const rawSegments: Array<{ startFrame: number; highlightFrames: number }> = [];

  const n = Math.max(1, Math.floor(segmentCount));
  for (let k = 0; k < n; k++) {
    const startFrame = await findBestHighlightStart(
      energies,
      totalFrames,
      highlightFrames,
      excludeRanges,
    );
    if (startFrame === null) {
      break;
    }
    rawSegments.push({ startFrame, highlightFrames });
    excludeRanges.push({ start: startFrame, endExclusive: startFrame + highlightFrames });
  }

  rawSegments.sort((a, b) => a.startFrame - b.startFrame);

  const runs = rawSegments.map(seg =>
    buildHighlightRun(fps, seg, spectrums, beatEvents),
  );

  const slicedSpectrums: number[][] = [];
  const beatFrameIndices: number[] = [];
  let outOffset = 0;

  for (const seg of rawSegments) {
    const chunk = spectrums.slice(seg.startFrame, seg.startFrame + seg.highlightFrames);
    slicedSpectrums.push(...chunk);

    for (const b of beatEvents) {
      const i = b.frameIndex;
      if (i >= seg.startFrame && i < seg.startFrame + seg.highlightFrames) {
        beatFrameIndices.push(i - seg.startFrame + outOffset);
      }
    }
    outOffset += seg.highlightFrames;
  }

  beatFrameIndices.sort((a, b) => a - b);

  const totalHighlightFrames = slicedSpectrums.length;
  const audioSegments: HighlightAudioSegment[] = rawSegments.map(seg => ({
    seekSeconds: seg.startFrame / fps,
    durationSeconds: seg.highlightFrames / fps,
  }));

  const first = audioSegments[0] ?? { seekSeconds: 0, durationSeconds: 0 };

  return {
    startFrame: rawSegments[0]?.startFrame ?? 0,
    highlightFrames: totalHighlightFrames,
    spectrums: slicedSpectrums,
    beatFrameIndices,
    audioSeekSeconds: first.seekSeconds,
    audioDurationSeconds: first.durationSeconds,
    audioSegments,
    runs,
  };
}
