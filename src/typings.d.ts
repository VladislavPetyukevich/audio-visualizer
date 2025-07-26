declare module 'fft-js' {
  export function fft(signal: number[]): [number, number][];
  export const util: {
    fftFreq(phasors: [number, number][], sampleRate: number): number[];
    fftMag(phasors: [number, number][]): number[];
  };
}