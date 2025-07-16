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
    const signal = Array(Math.pow(2, 12)).fill(1);

    const result = getSpectrum(signal, 44100);
    expect(result).to.have.length(24);
  });
});
