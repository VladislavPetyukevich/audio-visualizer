import { expect } from 'chai';
import { estimateTempo, beatGridFrameIndices, shiftTempoPhase } from '../beats';

const clickTrain = (
  sampleRate: number,
  bpm: number,
  durationSec: number,
  phaseSec = 0,
  halfPeriodGhost = 0,
): number[] => {
  const n = Math.round(sampleRate * durationSec);
  const samples = new Array<number>(n).fill(0);
  const period = 60 / bpm;
  const clickLen = Math.round(sampleRate * 0.01);
  const addClick = (timeSec: number, amplitude: number) => {
    const start = Math.round(timeSec * sampleRate);
    for (let i = 0; i < clickLen && start + i < n; i++) {
      const env = Math.exp(-i / (clickLen * 0.25));
      samples[start + i] += amplitude * env * (i % 2 === 0 ? 1 : -0.7);
    }
  };
  for (let t = phaseSec; t < durationSec; t += period) {
    addClick(t, 1);
    if (halfPeriodGhost > 0) {
      addClick(t + period / 2, halfPeriodGhost);
    }
  }
  return samples;
};

describe('beats', function () {
  this.timeout(10000);

  it('estimateTempo detects 128 BPM from a click train', function () {
    const sampleRate = 22050;
    const fps = 30;
    const tempo = estimateTempo(clickTrain(sampleRate, 128, 8), sampleRate, fps);
    expect(tempo).not.equal(null);
    expect(tempo!.bpm).closeTo(128, 8);
    expect(tempo!.periodFrames).closeTo(fps * 60 / 128, 1);
  });

  it('estimateTempo recovers phase of the click train', function () {
    const sampleRate = 22050;
    const fps = 30;
    const phaseSec = 0.1;
    const tempo = estimateTempo(clickTrain(sampleRate, 128, 8, phaseSec), sampleRate, fps);
    expect(tempo).not.equal(null);
    expect(tempo!.phaseFrame).closeTo(phaseSec * fps, 2);
  });

  it('estimateTempo prefers ~128 BPM when half-period ghosts are present', function () {
    const sampleRate = 22050;
    const fps = 30;
    const tempo = estimateTempo(clickTrain(sampleRate, 128, 8, 0, 0.35), sampleRate, fps);
    expect(tempo).not.equal(null);
    expect(tempo!.bpm).closeTo(128, 8);
  });

  it('estimateTempo returns null for silence', function () {
    const sampleRate = 22050;
    const samples = new Array<number>(sampleRate * 2).fill(0);
    expect(estimateTempo(samples, sampleRate, 30)).equal(null);
  });

  it('estimateTempo returns null for empty or invalid input', function () {
    expect(estimateTempo([], 22050, 30)).equal(null);
    expect(estimateTempo(clickTrain(22050, 128, 8), 0, 30)).equal(null);
    expect(estimateTempo(clickTrain(22050, 128, 8), 22050, 0)).equal(null);
  });

  it('shiftTempoPhase wraps the beat grid into a later window', function () {
    expect(shiftTempoPhase({ bpm: 120, periodFrames: 15, phaseFrame: 3 }, 0)).deep.equal({
      bpm: 120,
      periodFrames: 15,
      phaseFrame: 3,
    });
    expect(shiftTempoPhase({ bpm: 120, periodFrames: 15, phaseFrame: 3 }, 3).phaseFrame).equal(0);
    expect(shiftTempoPhase({ bpm: 120, periodFrames: 15, phaseFrame: 3 }, 18).phaseFrame).equal(0);
  });

  it('beatGridFrameIndices emits every beat and skips frame 0', function () {
    expect(beatGridFrameIndices({ periodFrames: 14, phaseFrame: 0 }, 50)).deep.equal([14, 28, 42]);
    expect(beatGridFrameIndices({ periodFrames: 14, phaseFrame: 3 }, 32)).deep.equal([3, 17, 31]);
    expect(beatGridFrameIndices({ periodFrames: 14, phaseFrame: 0 }, 14)).deep.equal([]);
  });

  it('beatGridFrameIndices stride emits every Nth beat', function () {
    expect(beatGridFrameIndices({ periodFrames: 14, phaseFrame: 0 }, 200, 4)).deep.equal([14, 70, 126, 182]);
    expect(beatGridFrameIndices({ periodFrames: 14, phaseFrame: 3 }, 200, 4)).deep.equal([3, 59, 115, 171]);
  });
});
