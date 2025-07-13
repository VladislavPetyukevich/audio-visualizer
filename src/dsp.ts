// @ts-ignore
import { fft } from 'fft-js';

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

export const getSpectrum = (PCMData: number[]) => {
  const signalLength = brutForceFFTSignalLength(PCMData.length);
  const signalStartIndex = Math.trunc(PCMData.length / 2 - signalLength / 2);
  const signal = PCMData.slice(signalStartIndex, signalStartIndex + signalLength);

  // Use fft-js to compute the FFT
  const phasors = fft(signal);
  
  // Convert complex numbers to magnitudes
  const spectrum = phasors.map(([real, imag]: [number, number]) => Math.sqrt(real * real + imag * imag));
  spectrum.length = Math.max(spectrum.length / 16, 1);

  // Apply the same frequency-dependent scaling as before
  for (let i = 0; i < spectrum.length; i++) {
    // attenuates low freqs and boosts highs
    spectrum[i] *= -1 * Math.log((signalLength / 2 - i) * (0.5 / signalLength / 2)) * signalLength;
  }
  return spectrum;
}
