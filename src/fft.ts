import { ifft, util as fftUtil } from 'fft-js';

const brutForceFFTSignalLength = (PCMDataLength: number) => {
  let exponent = 1;
  while (true) {
    const pow = Math.pow(2, exponent);
    if ((pow * 2) > PCMDataLength) {
      return Math.pow(2, exponent - 1) * 2;
    }
    exponent++;
  }
};

export const getFFT = (PCMData: number[], sampleRate: number) => {
  const signal = [];
  const signalLength = brutForceFFTSignalLength(PCMData.length);
  for (let i = 0; i < signalLength; i += 2) {
    signal.push(
      [
        PCMData[i],
        PCMData[i + 1]
      ]
    );
  }
  const phasors = ifft(signal);
  const frequencies = fftUtil.fftFreq(phasors, sampleRate);
  const magnitudes = fftUtil.fftMag(phasors);
  const both = frequencies.map(function (f, ix) {
    return { frequency: f, magnitude: magnitudes[ix] };
  });
  return both;
}
