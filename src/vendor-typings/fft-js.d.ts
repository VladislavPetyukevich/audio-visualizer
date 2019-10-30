declare module 'fft-js' {
  type Phasors = number[][];
  export function ifft(phasors: Phasors): Phasors;
  export namespace util {
    export function fftFreq(hasors: Phasors, sampleRate: number): number[];
    export function fftMag(hasors: Phasors): number[];
  }
}