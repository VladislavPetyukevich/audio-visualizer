declare module 'fft-js' {
  export function fft(signal: number[]): [number, number][];
  export const util: {
    fftFreq(phasors: [number, number][], sampleRate: number): number[];
    fftMag(phasors: [number, number][]): number[];
  };
}

declare module 'music-tempo' {
  export interface MusicTempoParams {
    bufferSize?: number;
    hopSize?: number;
    timeStep?: number;
    decayRate?: number;
    peakFindingWindow?: number;
    meanWndMultiplier?: number;
    peakThreshold?: number;
    minBeatInterval?: number;
    maxBeatInterval?: number;
    expiryTime?: number;
  }

  export default class MusicTempo {
    constructor(audioData: number[] | Float32Array, params?: MusicTempoParams);
    tempo: string | number;
    beats: number[];
    beatInterval: number;
  }
}