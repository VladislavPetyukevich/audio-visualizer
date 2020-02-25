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
    var signal = [1, 0, 0, 0, 1, 0, 0, 0];
    const fft = [8.317766166719343, 0, 11.090354888959125, 0];

    const result = getSpectrum(signal);
    expect(result).deep.equal(fft);
  });
});
