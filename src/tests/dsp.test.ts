import { expect } from 'chai';
import { brutForceFFTSignalLength, getSpectrum } from '../dsp';

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

  it('getSpectrum', function () {
    const signal = [1, 0, 1, 0];
    const fft = [2, 0, 2, 0];

    const result = getSpectrum(signal);
    expect(result).deep.equal(fft);
  });
});
