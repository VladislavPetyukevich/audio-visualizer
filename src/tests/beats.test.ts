import { expect } from 'chai';
import { estimateTempo, beatGridFrameIndices } from '../beats';

const BANDS = 24;
const BASS_BANDS = 8;

const makeSpectrum = (bassAmplitude: number): number[] =>
  Array.from({ length: BANDS }, (_, band) => (band < BASS_BANDS ? bassAmplitude : 0.01));

const pulseSpectrums = (
  fps: number,
  bpm: number,
  frameCount: number,
  phaseFrame = 0,
  halfPeriodGhost = 0,
): number[][] => {
  const period = fps * 60 / bpm;
  return Array.from({ length: frameCount }, (_, i) => {
    const k = Math.round((i - phaseFrame) / period);
    const nearest = phaseFrame + k * period;
    const dist = Math.abs(i - nearest);
    let amp = Math.exp(-(dist * dist) / (2 * 0.45 * 0.45));
    if (halfPeriodGhost > 0) {
      const halfPeriod = period / 2;
      const halfK = Math.round((i - phaseFrame) / halfPeriod);
      const halfNearest = phaseFrame + halfK * halfPeriod;
      const halfDist = Math.abs(i - halfNearest);
      const ghost = halfPeriodGhost * Math.exp(-(halfDist * halfDist) / (2 * 0.45 * 0.45));
      if (ghost > amp) {
        amp = ghost;
      }
    }
    return makeSpectrum(0.15 + amp);
  });
};

describe('beats', function () {
  it('estimateTempo detects 128 BPM from a pulse train', function () {
    const fps = 30;
    const tempo = estimateTempo(pulseSpectrums(fps, 128, fps * 12, 0), fps);
    expect(tempo).not.equal(null);
    expect(tempo!.bpm).closeTo(128, 8);
    expect(tempo!.periodFrames).closeTo(fps * 60 / 128, 1);
  });

  it('estimateTempo recovers phase of the pulse train', function () {
    const fps = 30;
    const phaseFrame = 3;
    const tempo = estimateTempo(pulseSpectrums(fps, 128, fps * 12, phaseFrame), fps);
    expect(tempo).not.equal(null);
    expect(tempo!.phaseFrame).equal(phaseFrame);
  });

  it('estimateTempo prefers ~128 BPM when half-period ghosts are present', function () {
    const fps = 30;
    const tempo = estimateTempo(pulseSpectrums(fps, 128, fps * 12, 0, 0.35), fps);
    expect(tempo).not.equal(null);
    expect(tempo!.bpm).closeTo(128, 8);
  });

  it('estimateTempo returns null for a flat envelope', function () {
    const spectrums = Array.from({ length: 240 }, () => makeSpectrum(0.4));
    expect(estimateTempo(spectrums, 30)).equal(null);
  });

  it('estimateTempo returns null for empty or invalid input', function () {
    expect(estimateTempo([], 30)).equal(null);
    expect(estimateTempo(pulseSpectrums(30, 128, 240), 0)).equal(null);
  });

  it('beatGridFrameIndices emits every beat and skips frame 0', function () {
    expect(beatGridFrameIndices({ periodFrames: 14, phaseFrame: 0 }, 50)).deep.equal([14, 28, 42]);
    expect(beatGridFrameIndices({ periodFrames: 14, phaseFrame: 3 }, 32)).deep.equal([3, 17, 31]);
    expect(beatGridFrameIndices({ periodFrames: 14, phaseFrame: 0 }, 14)).deep.equal([]);
  });
});
