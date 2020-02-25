import { createSpectrumAnalyzer } from './spectrum';

export const brutForceFFTSignalLength = (PCMDataLength: number) => {
  let exponent = 1;
  while (true) {
    const pow = Math.pow(2, exponent);
    if ((pow * 2) > PCMDataLength) {
      return Math.pow(2, exponent - 1) * 2;
    }
    exponent++;
  }
};

export const getSpectrum = (PCMData: number[], sampleRate: number) => {
  const signal = [];
  const signalLength = brutForceFFTSignalLength(PCMData.length);
  for (let i = 0; i < signalLength; i++) {
    signal.push(PCMData[i]);
  }
  const spectrumAnalyzer = createSpectrumAnalyzer(signalLength, sampleRate);
  const spectrum = spectrumAnalyzer(signal);
  for (let i = 0; i < spectrum.length; i++) {
    // attenuates low freqs and boosts highs
    spectrum[i] *= -1 * Math.log((signalLength / 2 - i) * (0.5 / signalLength / 2)) * signalLength;
  }
  return spectrum;
}
