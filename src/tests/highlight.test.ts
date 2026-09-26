import { expect } from 'chai';
import {
  computeHighlightSlice,
  HIGHLIGHT_DURATION_SEC,
  MAX_BEAT_SNAP_SEC,
  buildBeatCandidates,
  snapSegmentToBeats,
} from '../highlight';

const dummySpectrums = (n: number) => Array.from({ length: n }, () => [0]);

/** Non-zero spectrum only on [rangeStart, rangeEnd) so frame energy is concentrated there. */
function spectrumsWithEnergyInRange(
  n: number,
  rangeStart: number,
  rangeEndExclusive: number,
  binValue = 1,
): number[][] {
  return Array.from({ length: n }, (_, i) =>
    i >= rangeStart && i < rangeEndExclusive ? [binValue] : [0],
  );
}

describe('computeHighlightSlice', function() {
  it('centers window when energy is flat (e.g. silence)', async function() {
    const fps = 30;
    const totalFrames = 1000;
    const spectrums = dummySpectrums(totalFrames);
    const highlightFrames = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);
    const expectedStart = Math.floor((totalFrames - highlightFrames) / 2);

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, []);

    expect(result.highlightFrames).equal(highlightFrames);
    expect(result.startFrame).equal(expectedStart);
    expect(result.spectrums.length).equal(highlightFrames);
    expect(result.audioSeekSeconds).equal(expectedStart / fps);
    expect(result.audioDurationSeconds).equal(highlightFrames / fps);
    expect(result.audioSegments).deep.equal([
      { seekSeconds: expectedStart / fps, durationSeconds: highlightFrames / fps },
    ]);
    expect(result.runs).have.length(1);
    expect(result.runs[0].highlightFrames).equal(highlightFrames);
  });

  it('clamps to track end when the loudest stretch is only in the final window', async function() {
    const fps = 30;
    const totalFrames = 1000;
    const highlightFrames = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);
    const maxStart = totalFrames - highlightFrames;
    const spectrums = spectrumsWithEnergyInRange(totalFrames, maxStart, totalFrames);

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [
      { frameIndex: 950, intensity: 1 },
    ]);

    expect(result.startFrame).equal(maxStart);
    expect(result.highlightFrames).equal(highlightFrames);
    expect(result.spectrums.length).equal(highlightFrames);
    expect(result.audioSegments).deep.equal([
      { seekSeconds: maxStart / fps, durationSeconds: highlightFrames / fps },
    ]);
    expect(result.runs).have.length(1);
  });

  it('uses full track when shorter than highlight duration', async function() {
    const fps = 30;
    const totalFrames = 400;
    const spectrums = dummySpectrums(totalFrames);

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [
      { frameIndex: 100, intensity: 1 },
    ]);

    expect(result.startFrame).equal(0);
    expect(result.highlightFrames).equal(totalFrames);
    expect(result.spectrums.length).equal(totalFrames);
    expect(result.beatFrameIndices).deep.equal([100]);
    expect(result.audioSeekSeconds).equal(0);
    expect(result.audioDurationSeconds).equal(totalFrames / fps);
    expect(result.audioSegments).deep.equal([
      { seekSeconds: 0, durationSeconds: totalFrames / fps },
    ]);
    expect(result.runs).have.length(1);
    expect(result.runs[0].spectrums.length).equal(totalFrames);
  });

  it('remaps beat indices into the highlight window', async function() {
    const fps = 30;
    const totalFrames = 1000;
    const highlightFrames = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);
    const spectrums = spectrumsWithEnergyInRange(totalFrames, 300, 300 + highlightFrames);

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [
      { frameIndex: 300, intensity: 1 },
      { frameIndex: 400, intensity: 0.5 },
      { frameIndex: 800, intensity: 0.2 },
    ]);

    expect(result.startFrame).equal(300);
    expect(result.beatFrameIndices).deep.equal([0, 100]);
    expect(result.audioSegments).deep.equal([
      { seekSeconds: 300 / fps, durationSeconds: highlightFrames / fps },
    ]);
    expect(result.runs).have.length(1);
  });

  it('picks the window with the highest summed spectral energy', async function() {
    const fps = 30;
    const totalFrames = 1000;
    const highlightFrames = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);
    const loud = 10;
    const spectrums = spectrumsWithEnergyInRange(totalFrames, 10, 10 + highlightFrames, loud);

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [
      { frameIndex: 10, intensity: 99 },
      { frameIndex: 200, intensity: 0.4 },
      { frameIndex: 500, intensity: 0.9 },
    ]);

    expect(result.startFrame).equal(10);
    // The end moves from frame 460 onto the nearby beat at 500.
    expect(result.highlightFrames).equal(490);
    expect(result.audioSegments).deep.equal([
      { seekSeconds: 10 / fps, durationSeconds: 490 / fps },
    ]);
    expect(result.runs).have.length(1);
  });

  it('returns empty slice for zero frames', async function() {
    const result = await computeHighlightSlice(30, 0, [], []);
    expect(result.highlightFrames).equal(0);
    expect(result.spectrums).deep.equal([]);
    expect(result.beatFrameIndices).deep.equal([]);
    expect(result.audioSegments).deep.equal([]);
    expect(result.runs).deep.equal([]);
  });

  it('concatenates two non-overlapping highlights chronologically with segmentCount 2', async function() {
    const fps = 30;
    const totalFrames = 1000;
    const highlightFrames = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);
    const loudA = 10;
    const loudB = 5;
    const spectrumsA = spectrumsWithEnergyInRange(totalFrames, 0, 450, loudA);
    const spectrumsB = spectrumsWithEnergyInRange(totalFrames, 500, 950, loudB);
    const spectrums = spectrumsA.map((row, i) => {
      const b = spectrumsB[i];
      const v = (row[0] || 0) + (b[0] || 0);
      return v > 0 ? [v] : [0];
    });

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [
      { frameIndex: 50, intensity: 1 },
      { frameIndex: 550, intensity: 1 },
    ], 2);

    expect(result.highlightFrames).equal(highlightFrames * 2);
    expect(result.spectrums.length).equal(highlightFrames * 2);
    expect(result.startFrame).equal(0);
    expect(result.audioSegments).deep.equal([
      { seekSeconds: 0, durationSeconds: highlightFrames / fps },
      { seekSeconds: 500 / fps, durationSeconds: highlightFrames / fps },
    ]);
    expect(result.beatFrameIndices).deep.equal([50, 500]);
    expect(result.runs).have.length(2);
    expect(result.runs[0].startFrame).equal(0);
    expect(result.runs[1].startFrame).equal(500);
    expect(result.runs[0].spectrums.length).equal(highlightFrames);
    expect(result.runs[1].spectrums.length).equal(highlightFrames);
  });

  it('ignores extra segmentCount when only one full highlight window fits', async function() {
    const fps = 30;
    const totalFrames = 600;
    const highlightFrames = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);
    const spectrums = spectrumsWithEnergyInRange(totalFrames, 0, highlightFrames, 1);

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [], 3);

    expect(result.highlightFrames).equal(highlightFrames);
    expect(result.audioSegments).have.length(1);
    expect(result.runs).have.length(1);
  });

  it('starts the whole lead-in before the drop when leadInFrames is given', async function() {
    const fps = 10;
    const totalFrames = 1000;
    // Quiet until frame 600, loud after: the drop is at 600.
    const spectrums = spectrumsWithEnergyInRange(totalFrames, 600, totalFrames);
    const beats = Array.from({ length: 200 }, (_, i) => ({ frameIndex: i * 5, intensity: 1 }));

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, beats, 1, null, 43);

    expect(result.runs).have.length(1);
    expect(result.runs[0].startFrame).equal(557);
    expect(result.runs[0].leadInFrames).equal(43);
    // The lead-in comes on top of the ~15s that follow the drop.
    expect(result.runs[0].highlightFrames).equal(43 + Math.ceil(HIGHLIGHT_DURATION_SEC * fps));
  });

  it('shortens the lead-in to the track start when only an early drop fits', async function() {
    const fps = 10;
    // A full 130-frame lead-in needs a drop at 130+, but ~15s must follow it: only 100 fits.
    const totalFrames = 250;
    const spectrums = spectrumsWithEnergyInRange(totalFrames, 100, totalFrames);
    const beats = Array.from({ length: 50 }, (_, i) => ({ frameIndex: i * 5, intensity: 1 }));

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, beats, 1, null, 130);

    expect(result.runs[0].startFrame).equal(0);
    expect(result.runs[0].leadInFrames).equal(100);
  });

  it('picks a separate drop for each highlight', async function() {
    const fps = 10;
    const totalFrames = 2000;
    const spectrums = Array.from({ length: totalFrames }, (_, i) =>
      (i >= 500 && i < 800) || (i >= 1400 && i < 1700) ? [1] : [0],
    );
    const beats = Array.from({ length: 400 }, (_, i) => ({ frameIndex: i * 5, intensity: 1 }));

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, beats, 2, null, 30);

    expect(result.runs.map(run => run.startFrame + (run.leadInFrames as number))).deep.equal([500, 1400]);
    expect(result.runs.map(run => run.leadInFrames)).deep.equal([30, 30]);
  });

  it('puts the lead-in before the energy window when no drop is found', async function() {
    const fps = 10;
    const totalFrames = 1000;
    const highlightFrames = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);
    const spectrums = spectrumsWithEnergyInRange(totalFrames, 600, totalFrames);

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [], 1, null, 900);

    // The window starts at 600; only 600 frames of the lead-in fit before it.
    expect(result.runs[0].startFrame).equal(0);
    expect(result.runs[0].leadInFrames).equal(600);
    expect(result.runs[0].highlightFrames).equal(600 + highlightFrames);
  });

  it('snaps highlight start and end onto detected beats', async function() {
    const fps = 30;
    const totalFrames = 1000;
    const highlightFrames = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);
    const spectrums = spectrumsWithEnergyInRange(totalFrames, 300, 300 + highlightFrames);

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [
      { frameIndex: 290, intensity: 1 },
      { frameIndex: 600, intensity: 1 },
      { frameIndex: 760, intensity: 1 },
    ]);

    expect(result.startFrame).equal(290);
    expect(result.highlightFrames).equal(760 - 290);
    expect(result.audioSegments).deep.equal([
      { seekSeconds: 290 / fps, durationSeconds: (760 - 290) / fps },
    ]);
    expect(result.beatFrameIndices).deep.equal([0, 310]);
  });

  it('snaps to a tempo grid and prefers a whole number of bars', async function() {
    const fps = 30;
    const totalFrames = 2000;
    const highlightFrames = Math.ceil(HIGHLIGHT_DURATION_SEC * fps);
    const spectrums = spectrumsWithEnergyInRange(totalFrames, 505, 505 + highlightFrames);
    // 120 BPM at 30 fps: a beat every 15 frames, a bar every 60.
    const beatGrid = { periodFrames: 15, phaseFrame: 5 };

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [], 1, beatGrid);

    expect((result.startFrame - 5) % 15).equal(0);
    expect(result.highlightFrames % 60).equal(0);
    expect(Math.abs(result.startFrame - 505)).lte(MAX_BEAT_SNAP_SEC * fps);
    expect(Math.abs(result.highlightFrames - highlightFrames)).lte(2 * MAX_BEAT_SNAP_SEC * fps);
  });

  it('keeps several snapped highlights from overlapping', async function() {
    const fps = 30;
    const totalFrames = 3000;
    const spectrums = Array.from({ length: totalFrames }, (_, i) => [1 + Math.sin(i / 50)]);
    const beatGrid = { periodFrames: 14, phaseFrame: 3 };

    const result = await computeHighlightSlice(fps, totalFrames, spectrums, [], 4, beatGrid);

    for (let i = 1; i < result.runs.length; i++) {
      const prev = result.runs[i - 1];
      expect(result.runs[i].startFrame).gte(prev.startFrame + prev.highlightFrames);
    }
  });
});

describe('buildBeatCandidates', function() {
  it('uses onsets when no tempo grid is given', function() {
    expect(buildBeatCandidates(30, 100, [
      { frameIndex: 40, intensity: 1 },
      { frameIndex: 10, intensity: 1 },
      { frameIndex: 10, intensity: 1 },
    ])).deep.equal([10, 40]);
  });

  it('uses tracked beats, then the grid nudged onto nearby onsets', function() {
    const frames = buildBeatCandidates(10, 60, [{ frameIndex: 41, intensity: 1 }], {
      periodFrames: 10,
      phaseFrame: 0,
      beatsSec: [0.1, 1.1, 2.1],
    });
    expect(frames).deep.equal([1, 11, 21, 30, 41, 50, 60]);
  });
});

describe('snapSegmentToBeats', function() {
  it('leaves a segment unchanged when no beat is close enough', function() {
    const seg = { startFrame: 100, highlightFrames: 200 };
    expect(snapSegmentToBeats(seg, 1000, [10, 900], 20)).deep.equal(seg);
  });
});
