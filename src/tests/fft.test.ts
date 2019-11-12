import { expect } from 'chai';
import { brutForceFFTSignalLength, getFFT } from '../fft';

describe('fft', function () {
  it('brutForceFFTSignalLength', function () {
    const expectedResultMap = {
      1: 2,
      4: 4,
      10: 8,
      123: 64
    };
    Object.entries(expectedResultMap).forEach(
      ([argument, expectedResult]) =>
        expect(brutForceFFTSignalLength(+argument)).equal(expectedResult)
    );
  });

  it('getFFT', function () {
    var signal = [1, 0, 0, 0, 1, 0, 0, 0];
    const sampleRate = 8000;
    const fft = [
      { frequency: 0, magnitude: 0.5 },
      { frequency: 2000, magnitude: 0 }
    ];

    const result = getFFT(signal, sampleRate);
    expect(result).deep.equal(fft);
  });
});
