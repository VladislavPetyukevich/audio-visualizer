/** Output length per segment when `audio.autoHighlight` is true (seconds). */

import { waitForEventLoop } from "./waitForEventLoop";

export const HIGHLIGHT_DURATION_SEC = 15;

export interface BeatFrameEvent {
  frameIndex: number;
  intensity: number;
}

/**
 * How far (seconds) a highlight boundary may move to land on a beat. The final length can
 * therefore differ from `HIGHLIGHT_DURATION_SEC` by up to twice this value.
 */
export const MAX_BEAT_SNAP_SEC = 1.5;
/** Beats per bar used when preferring highlight lengths made of whole bars. */
const BEATS_PER_BAR = 4;
/** Cost (in beats of boundary shift) for each beat the length is away from a whole bar. */
const OFF_BAR_PENALTY = 3;
/** Grid beats past the analyzed tempo region snap to a detected onset within this share of a beat. */
const GRID_ONSET_SNAP_SHARE = 0.2;
/** Seconds of audio compared before and after a frame to score it as a drop. */
export const DROP_WINDOW_SEC = 4;
/** Share of the track's biggest energy rise a peak needs to count as a drop. */
const MIN_DROP_SCORE_SHARE = 0.5;
/** With a tempo grid, a drop moves onto a beat within this share of a beat, so the hook ends on the beat. */
const DROP_BEAT_SNAP_SHARE = 0.2;

/** Tempo grid used to snap highlight cuts to beats (subset of `TempoEstimate`). */
export interface HighlightBeatGrid {
  periodFrames: number;
  phaseFrame: number;
  /** Beat times in seconds from the start of the audio. */
  beatsSec?: number[];
}

export interface HighlightAudioSegment {
  seekSeconds: number;
  durationSeconds: number;
  /** Silence played before the audio, for a lead-in reaching back past the track start. */
  delaySeconds?: number;
}

/** One auto-highlight segment before concatenation (for separate output files). */
export interface HighlightRun {
  startFrame: number;
  highlightFrames: number;
  spectrums: number[][];
  beatFrameIndices: number[];
  beatIntensities: number[];
  audioSegment: HighlightAudioSegment;
  /** Frames from the run start to the detected drop (or window start); set when a lead-in was requested. */
  leadInFrames?: number;
}

/**
 * `seg.startFrame` may be negative (a lead-in reaching back past the track start): those
 * frames get silent spectrums and are played as silence before the audio.
 */
function buildHighlightRun(
  fps: number,
  seg: { startFrame: number; highlightFrames: number; leadInFrames?: number },
  spectrums: number[][],
  beatEvents: BeatFrameEvent[],
): HighlightRun {
  const { startFrame, highlightFrames, leadInFrames } = seg;
  const silentFrames = Math.max(0, -startFrame);
  const silentSpectrum = new Array<number>(spectrums[0]?.length ?? 0).fill(0);
  const spectrumsSlice = [
    ...Array.from({ length: silentFrames }, () => silentSpectrum.slice()),
    ...spectrums.slice(startFrame + silentFrames, startFrame + highlightFrames),
  ];
  const beatsInWindow = beatEvents
    .filter(b => b.frameIndex >= startFrame && b.frameIndex < startFrame + highlightFrames)
    .sort((a, b) => a.frameIndex - b.frameIndex);
  const beatFrameIndices = beatsInWindow.map(b => b.frameIndex - startFrame);
  const beatIntensities = beatsInWindow.map(b => b.intensity);
  return {
    startFrame,
    highlightFrames,
    spectrums: spectrumsSlice,
    beatFrameIndices,
    beatIntensities,
    audioSegment: {
      seekSeconds: (startFrame + silentFrames) / fps,
      durationSeconds: (highlightFrames - silentFrames) / fps,
      ...(silentFrames > 0 && { delaySeconds: silentFrames / fps }),
    },
    ...(leadInFrames !== undefined && { leadInFrames }),
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
 * Scores each frame by the rise in mean energy from the `dropWindowFrames` before it to the
 * `dropWindowFrames` after it, and picks the best drop, i.e. a frame whose rise is the biggest
 * within `dropWindowFrames` on either side, such that the lead-in before it plus `mainFrames`
 * after it fit in the track and miss the excluded ranges. Frames rather than beat candidates are
 * scored so the drop lands on the actual energy onset (a beat grid can be off by a fraction of a
 * beat), and only peaks count so a frame just past a drop is never taken for one. Peaks rising
 * less than `MIN_DROP_SCORE_SHARE` of the biggest one are not drops. The window
 * starts exactly `leadInFrames` before the drop, so the whole lead-in plays. Drops too close to
 * the track start for the full lead-in are only used (with the window starting before the track,
 * i.e. at a negative frame) when no other drop fits.
 */
function findBestDropSegment(
  energies: Float64Array,
  totalFrames: number,
  mainFrames: number,
  leadInFrames: number,
  dropWindowFrames: number,
  excludeRanges: Array<{ start: number; endExclusive: number }>,
): { startFrame: number; dropFrame: number } | null {
  const prefix = new Float64Array(totalFrames + 1);
  for (let i = 0; i < totalFrames; i++) {
    prefix[i + 1] = prefix[i] + energies[i];
  }
  const meanEnergy = (from: number, to: number) => {
    const a = Math.max(0, from);
    const b = Math.min(totalFrames, to);
    return b > a ? (prefix[b] - prefix[a]) / (b - a) : 0;
  };
  const scores = new Float64Array(totalFrames);
  for (let f = 0; f < totalFrames; f++) {
    scores[f] = meanEnergy(f, f + dropWindowFrames) - meanEnergy(f - dropWindowFrames, f);
  }
  const dropFrames: number[] = [];
  for (let f = 1; f < totalFrames; f++) {
    if (!(scores[f] > 0)) {
      continue;
    }
    let isPeak = true;
    const from = Math.max(0, f - dropWindowFrames);
    const to = Math.min(totalFrames - 1, f + dropWindowFrames);
    for (let g = from; g <= to && isPeak; g++) {
      // Ties go to the earliest frame, where the rise starts.
      isPeak = scores[g] < scores[f] || (scores[g] === scores[f] && g >= f);
    }
    if (isPeak) {
      dropFrames.push(f);
    }
  }
  const maxScore = dropFrames.reduce((max, f) => Math.max(max, scores[f]), 0);
  const strongDropFrames = dropFrames.filter(f => scores[f] >= maxScore * MIN_DROP_SCORE_SHARE);

  const findBest = (allowBeforeTrackStart: boolean) => {
    let best: { startFrame: number; dropFrame: number } | null = null;
    let bestScore = -Infinity;
    for (const dropFrame of strongDropFrames) {
      const startFrame = dropFrame - leadInFrames;
      if (startFrame < 0 && !allowBeforeTrackStart) {
        continue;
      }
      if (
        dropFrame + mainFrames > totalFrames ||
        rangesOverlap(startFrame, dropFrame + mainFrames, excludeRanges)
      ) {
        continue;
      }
      if (scores[dropFrame] > bestScore) {
        bestScore = scores[dropFrame];
        best = { startFrame, dropFrame };
      }
    }
    return best;
  };
  return findBest(false) ?? findBest(true);
}

/**
 * Moves a drop (and its window start with it) onto the nearest beat within `DROP_BEAT_SNAP_SHARE`
 * of a beat. Only done with a tempo grid: raw onsets alone are too unreliable to override the
 * energy onset. A lead-in that fit in the track is never pushed back past its start.
 */
export function snapDropToBeat(
  drop: { startFrame: number; dropFrame: number },
  beatFrames: number[],
  periodFrames?: number,
): void {
  if (!periodFrames || !(periodFrames > 0) || !isFinite(periodFrames)) {
    return;
  }
  const beat = nearestOnset(beatFrames, drop.dropFrame);
  if (beat === null || Math.abs(beat - drop.dropFrame) > periodFrames * DROP_BEAT_SNAP_SHARE) {
    return;
  }
  const startFrame = drop.startFrame + (beat - drop.dropFrame);
  if (startFrame < 0 && drop.startFrame >= 0) {
    return;
  }
  drop.startFrame = startFrame;
  drop.dropFrame = beat;
}

function nearestOnset(sortedOnsets: number[], frame: number): number | null {
  let lo = 0;
  let hi = sortedOnsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedOnsets[mid] < frame) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  let best: number | null = null;
  for (const i of [lo - 1, lo]) {
    if (i >= 0 && i < sortedOnsets.length) {
      const v = sortedOnsets[i];
      if (best === null || Math.abs(v - frame) < Math.abs(best - frame)) {
        best = v;
      }
    }
  }
  return best;
}

/**
 * Beat frames (sorted, unique, within [0, totalFrames]) where a highlight may start or end.
 * With a tempo grid: tracked beats from the analyzed region, then the regular grid beyond it
 * (each grid beat nudged onto a nearby detected onset to follow slight tempo drift).
 * Without one: the detected onset beats.
 */
export function buildBeatCandidates(
  fps: number,
  totalFrames: number,
  beatEvents: BeatFrameEvent[],
  beatGrid?: HighlightBeatGrid | null,
): number[] {
  const onsets = Array.from(new Set(beatEvents.map(b => b.frameIndex)))
    .filter(f => f >= 0 && f <= totalFrames)
    .sort((a, b) => a - b);
  const period = beatGrid?.periodFrames ?? 0;
  if (!beatGrid || !(period > 0) || !isFinite(period)) {
    return onsets;
  }

  const frames = new Set<number>();
  let lastTracked = -Infinity;
  for (const t of beatGrid.beatsSec ?? []) {
    const f = Math.round(t * fps);
    if (f >= 0 && f <= totalFrames) {
      frames.add(f);
      lastTracked = Math.max(lastTracked, f);
    }
  }

  const maxOnsetShift = period * GRID_ONSET_SNAP_SHARE;
  const firstN = Math.ceil(-beatGrid.phaseFrame / period);
  for (let n = firstN; ; n++) {
    const gridFrame = beatGrid.phaseFrame + n * period;
    if (gridFrame > totalFrames) {
      break;
    }
    if (gridFrame <= lastTracked + period / 2) {
      continue;
    }
    const onset = nearestOnset(onsets, gridFrame);
    const f = onset !== null && Math.abs(onset - gridFrame) <= maxOnsetShift
      ? onset
      : Math.round(gridFrame);
    if (f >= 0 && f <= totalFrames) {
      frames.add(f);
    }
  }
  return Array.from(frames).sort((a, b) => a - b);
}

/**
 * Moves a fixed-length window's start and end onto beats (each by at most `maxShiftFrames`),
 * preferring lengths that span whole bars when the beat period is known.
 * Boundaries without a nearby beat stay where they are.
 */
export function snapSegmentToBeats(
  seg: { startFrame: number; highlightFrames: number },
  totalFrames: number,
  beatFrames: number[],
  maxShiftFrames: number,
  periodFrames?: number,
  /** Keep the start where it is and only move the end. */
  lockStart = false,
): { startFrame: number; highlightFrames: number } {
  const rawStart = seg.startFrame;
  const rawEnd = seg.startFrame + seg.highlightFrames;
  const near = (target: number, max: number) =>
    beatFrames.filter(f => Math.abs(f - target) <= maxShiftFrames && f >= 0 && f <= max);
  const startCands = lockStart ? [rawStart] : near(rawStart, totalFrames - 1);
  const endCands = near(rawEnd, totalFrames);
  if (startCands.length === 0) {
    startCands.push(rawStart);
  }
  if (endCands.length === 0) {
    endCands.push(Math.min(rawEnd, totalFrames));
  }

  const period = periodFrames && periodFrames > 0 && isFinite(periodFrames) ? periodFrames : 0;
  const shiftUnit = period > 0 ? period : Math.max(1, maxShiftFrames);
  let best: { startFrame: number; endFrame: number } | null = null;
  let bestCost = Infinity;
  for (const s of startCands) {
    for (const e of endCands) {
      if (e - s < seg.highlightFrames / 2) {
        continue;
      }
      let cost = (Math.abs(s - rawStart) + Math.abs(e - rawEnd)) / shiftUnit;
      if (period > 0) {
        const beats = Math.round((e - s) / period);
        const offBar = Math.abs(beats - BEATS_PER_BAR * Math.round(beats / BEATS_PER_BAR));
        cost += offBar * OFF_BAR_PENALTY;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = { startFrame: s, endFrame: e };
      }
    }
  }
  if (!best) {
    return seg;
  }
  return { startFrame: best.startFrame, highlightFrames: best.endFrame - best.startFrame };
}

/**
 * Picks up to `segmentCount` non-overlapping ~15s windows with highest summed spectral energy each,
 * moves their boundaries onto beats (see `snapSegmentToBeats`), sorts them chronologically,
 * concatenates spectrums, and remaps beat indices.
 *
 * With `leadInFrames` (e.g. a hook video's length), each window is instead built around a detected
 * drop: it starts `leadInFrames` before the drop, so the whole lead-in plays and ends on the drop
 * (see `HighlightRun.leadInFrames`), and runs ~15s past the drop, so the lead-in is added on top of
 * the ~15s rather than taken out of it. With a tempo grid, the drop is moved onto a nearby beat
 * (see `snapDropToBeat`), so the hook ends on the beat. When no drop fits, the lead-in is put before the energy
 * window instead. The lead-in is never shortened: where it reaches back past the track start,
 * the run starts at a negative frame and that part is silent (see `buildHighlightRun`).
 */
export async function computeHighlightSlice(
  fps: number,
  totalFrames: number,
  spectrums: number[][],
  beatEvents: BeatFrameEvent[],
  segmentCount = 1,
  beatGrid?: HighlightBeatGrid | null,
  leadInFrames?: number,
): Promise<{
  startFrame: number;
  highlightFrames: number;
  spectrums: number[][];
  beatFrameIndices: number[];
  beatIntensities: number[];
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
      beatIntensities: [],
      audioSeekSeconds: 0,
      audioDurationSeconds: 0,
      audioSegments: [],
      runs: [],
    };
  }

  if (totalFrames <= highlightFramesTarget) {
    // The whole track follows the lead-in, which is silent as it all comes before the track start.
    const leadIn = leadInFrames !== undefined && leadInFrames > 0 ? leadInFrames : 0;
    const fullSeg = leadIn > 0
      ? { startFrame: -leadIn, highlightFrames: leadIn + totalFrames, leadInFrames: leadIn }
      : { startFrame: 0, highlightFrames: totalFrames };
    const fullRun = buildHighlightRun(fps, fullSeg, spectrums, beatEvents);
    return {
      startFrame: fullRun.startFrame,
      highlightFrames: fullRun.highlightFrames,
      spectrums: fullRun.spectrums,
      beatFrameIndices: fullRun.beatFrameIndices,
      beatIntensities: fullRun.beatIntensities,
      audioSeekSeconds: fullRun.audioSegment.seekSeconds,
      audioDurationSeconds: fullRun.audioSegment.durationSeconds,
      audioSegments: [fullRun.audioSegment],
      runs: [fullRun],
    };
  }

  const highlightFrames = highlightFramesTarget;
  const energies = await buildFrameEnergies(spectrums, totalFrames);
  const excludeRanges: Array<{ start: number; endExclusive: number }> = [];
  const rawSegments: Array<{ startFrame: number; highlightFrames: number; leadInFrames?: number }> = [];
  const beatFrames = buildBeatCandidates(fps, totalFrames, beatEvents, beatGrid);
  const maxShiftFrames = Math.round(MAX_BEAT_SNAP_SEC * fps);
  const useDrops = leadInFrames !== undefined && leadInFrames > 0;
  const dropWindowFrames = Math.round(DROP_WINDOW_SEC * fps);

  const n = Math.max(1, Math.floor(segmentCount));
  for (let k = 0; k < n; k++) {
    const drop = useDrops
      ? findBestDropSegment(
          energies,
          totalFrames,
          highlightFrames,
          leadInFrames as number,
          dropWindowFrames,
          excludeRanges,
        )
      : null;
    if (drop) {
      snapDropToBeat(drop, beatFrames, beatGrid?.periodFrames);
      // Only the part from the drop on is ~15s; its end is snapped to a beat.
      const main = snapSegmentToBeats(
        { startFrame: drop.dropFrame, highlightFrames },
        totalFrames,
        beatFrames,
        maxShiftFrames,
        beatGrid?.periodFrames,
        true,
      );
      const dropLeadIn = drop.dropFrame - drop.startFrame;
      rawSegments.push({
        startFrame: drop.startFrame,
        highlightFrames: dropLeadIn + main.highlightFrames,
        leadInFrames: dropLeadIn,
      });
      excludeRanges.push({
        start: drop.startFrame - maxShiftFrames,
        endExclusive: main.startFrame + main.highlightFrames + maxShiftFrames,
      });
      await waitForEventLoop();
      continue;
    }
    const startFrame = await findBestHighlightStart(
      energies,
      totalFrames,
      highlightFrames,
      excludeRanges,
    );
    if (startFrame === null) {
      break;
    }
    const snapped = snapSegmentToBeats(
      { startFrame, highlightFrames },
      totalFrames,
      beatFrames,
      maxShiftFrames,
      beatGrid?.periodFrames,
    );
    // The whole lead-in plays before the window, even over an earlier window (each highlight with
    // a lead-in is its own output) or before the track start (as silence).
    const windowLeadIn = useDrops ? leadInFrames as number : 0;
    rawSegments.push(windowLeadIn > 0
      ? {
          startFrame: snapped.startFrame - windowLeadIn,
          highlightFrames: windowLeadIn + snapped.highlightFrames,
          leadInFrames: windowLeadIn,
        }
      : snapped);
    // Padded so the next raw window, once snapped, cannot reach back into this one.
    excludeRanges.push({
      start: snapped.startFrame - maxShiftFrames,
      endExclusive: snapped.startFrame + snapped.highlightFrames + maxShiftFrames,
    });
  }

  rawSegments.sort((a, b) => a.startFrame - b.startFrame);

  const runs = rawSegments.map(seg =>
    buildHighlightRun(fps, seg, spectrums, beatEvents),
  );

  const slicedSpectrums: number[][] = [];
  const beatFrameIndices: number[] = [];
  const beatIntensities: number[] = [];
  let outOffset = 0;

  for (const run of runs) {
    slicedSpectrums.push(...run.spectrums);
    beatFrameIndices.push(...run.beatFrameIndices.map(frameIndex => frameIndex + outOffset));
    beatIntensities.push(...run.beatIntensities);
    outOffset += run.highlightFrames;
  }

  const totalHighlightFrames = slicedSpectrums.length;
  const audioSegments: HighlightAudioSegment[] = runs.map(run => run.audioSegment);

  const first = audioSegments[0] ?? { seekSeconds: 0, durationSeconds: 0 };

  return {
    startFrame: rawSegments[0]?.startFrame ?? 0,
    highlightFrames: totalHighlightFrames,
    spectrums: slicedSpectrums,
    beatFrameIndices,
    beatIntensities,
    audioSeekSeconds: first.seekSeconds,
    audioDurationSeconds: first.durationSeconds,
    audioSegments,
    runs,
  };
}
