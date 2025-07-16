import { fft, util } from 'fft-js';

export interface SpectrumPoint {
  frequency: number;
  magnitude: number;
}

export interface FrequencyBus {
  startFreq: number;
  endFreq: number;
  magnitude: number;
}

// Common frequency bands (in Hz)
export const FREQUENCY_BANDS = [
  { name: 'Sub Bass 1', start: 20, end: 30 },
  { name: 'Sub Bass 2', start: 30, end: 40 },
  { name: 'Sub Bass 3', start: 50, end: 60 },
  { name: 'Sub Bass 4', start: 20, end: 60 },
  { name: 'Bass 1', start: 60, end: 107.5 },
  { name: 'Bass 2', start: 107.5, end: 155 },
  { name: 'Bass 3', start: 155, end: 202.5 },
  { name: 'Bass 4', start: 202.5, end: 250 },
  { name: 'Low Mids 1', start: 250, end: 312.5 },
  { name: 'Low Mids 2', start: 312.5, end: 375 },
  { name: 'Low Mids 3', start: 375, end: 437.5 },
  { name: 'Low Mids 4', start: 437.5, end: 500 },
  { name: 'Mids 1', start: 500, end: 875 },
  { name: 'Mids 2', start: 875, end: 1250 },
  { name: 'Mids 3', start: 1250, end: 1625 },
  { name: 'Mids 4', start: 1625, end: 2000 },
  { name: 'High Mids 1', start: 2000, end: 2500 },
  { name: 'High Mids 2', start: 2500, end: 3000 },
  { name: 'High Mids 3', start: 3000, end: 3500 },
  { name: 'High Mids 4', start: 3500, end: 4000 },
  { name: 'Presence 1', start: 4000, end: 5000 },
  { name: 'Presence 2', start: 5000, end: 6000 },
  { name: 'Brilliance 1', start: 6000, end: 13000 },
  { name: 'Brilliance 2', start: 13000, end: 20000 },
];

const combineToBuses = (spectrum: SpectrumPoint[]): number[] => {
  return FREQUENCY_BANDS.map(band => {
    const pointsInBand = spectrum.filter(point => 
      point.frequency >= band.start && point.frequency < band.end
    );
    
    // If no points found in this band, return zero magnitude
    if (pointsInBand.length === 0) {
      return 0;
    }

    // Average the magnitudes in this frequency band
    const avgMagnitude = pointsInBand.reduce((sum, point) => 
      sum + point.magnitude, 0) / pointsInBand.length;

    return avgMagnitude;
  });
};

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

export const getSpectrum = (PCMData: number[], sampleRate: number): number[] => {
  const signalLength = brutForceFFTSignalLength(PCMData.length);
  const signalStartIndex = Math.trunc(PCMData.length / 2 - signalLength / 2);
  const signal = PCMData.slice(signalStartIndex, signalStartIndex + signalLength);

  // Use fft-js to compute the FFT
  const phasors = fft(signal);
  const frequencies = util.fftFreq(phasors, sampleRate);
  const magnitudes = util.fftMag(phasors);

  // Create combined spectrum array with both frequency and magnitude
  let spectrum: SpectrumPoint[] = frequencies.map((freq: number, i: number) => ({
    frequency: freq,
    magnitude: magnitudes[i]
  }));

  // Apply frequency-dependent scaling
  for (let i = 0; i < spectrum.length; i++) {
    spectrum[i].magnitude *= -1 * Math.log((signalLength / 2 - i) * (0.5 / signalLength / 2)) * signalLength;
  }

  // Combine frequencies into buses
  return combineToBuses(spectrum);
}
