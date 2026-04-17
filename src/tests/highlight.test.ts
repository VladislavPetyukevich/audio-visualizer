import { expect } from 'chai';

import { computeHighlightSlice, HIGHLIGHT_DURATION_SEC } from '../highlight';



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

    expect(result.highlightFrames).equal(highlightFrames);

    expect(result.audioSegments).deep.equal([
      { seekSeconds: 10 / fps, durationSeconds: highlightFrames / fps },
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

});

