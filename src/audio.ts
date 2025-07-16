import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { getSpectrum } from './dsp';

export const skipEvery = <T>(skipIndex: number) => (element: T, index: number) =>
  index % skipIndex === 0;

export const getPeaks = (spectrums: number[], prevPeaks?: number[]) => {
  if (!prevPeaks) {
    return spectrums;
  }
  const resultPeaks: number[] = [];
  for (let i = 0; i < spectrums.length; i++) {
    const currValue = spectrums[i];
    const currPrevPeak = prevPeaks[i] || 0;
    resultPeaks.push(
      (currValue > currPrevPeak) ? currValue : currPrevPeak
    );
  }
  return resultPeaks;
};

export const correctPeaks = (spectrums: number[], peaks: number[]) => {
  const resultSpectrum: number[] = [];
  for (let i = 0; i < spectrums.length; i++) {
    const value = spectrums[i];
    const peakValue = peaks[i] || 0;
    if (value < 3) {
      resultSpectrum.push(value / 3);
    } else {
      resultSpectrum.push(value / peakValue);
    }
  }
  return resultSpectrum;
};

// Number of previous frames to use for smoothing
const SPECTRUM_HISTORY_SIZE = 2;

export const smoothValues = (spectrums: number[], prevSpectrums?: number[][]) => {
  if (!prevSpectrums || !prevSpectrums.length) {
    return spectrums;
  }
  const resultSpectrum: number[] = [];
  
  for (let i = 0; i < spectrums.length; i++) {
    const currValue = spectrums[i];
    // Calculate weighted average of current and previous values
    // More recent values have higher weights
    let weightedSum = currValue;
    let totalWeight = 1;
    
    for (let j = 0; j < prevSpectrums.length; j++) {
      const weight = 1 / (j + 2); // Decreasing weights for older values
      const prevValue = prevSpectrums[j][i] || 0;
      weightedSum += prevValue * weight;
      totalWeight += weight;
    }
    
    resultSpectrum.push(weightedSum / totalWeight);
  }
  return resultSpectrum;
};

export const createSpectrumsProcessor = (sampleRate: number) => {
  let prevAudioDataNormalized: number[] = [];
  let prevPeaks: number[] = [];
  let prevSpectrums: number[][] = [];
  const skipFrameIndex = 2;

  return (frameIndex: number, parseAudioData: () => number[]) => {
    const isFrameSkiped = 
      frameIndex && (frameIndex % skipFrameIndex === 0);
    const audioDataNomrmalized = isFrameSkiped ?
      prevAudioDataNormalized :
      normalizeAudioData(parseAudioData());
    prevAudioDataNormalized = audioDataNomrmalized;

    const spectrum = getSpectrum(audioDataNomrmalized, sampleRate);

    const peaks = getPeaks(spectrum, prevPeaks);
    const correctedSpectrum = correctPeaks(spectrum, peaks);
    const smoothSpectrum = smoothValues(correctedSpectrum, prevSpectrums);
    
    // Update spectrum history
    prevSpectrums.unshift(smoothSpectrum);
    if (prevSpectrums.length > SPECTRUM_HISTORY_SIZE) {
      prevSpectrums.pop();
    }
    
    prevPeaks = peaks;

    return smoothSpectrum;
  };
};

export const bufferToUInt8 = (buffer: Buffer, start: number, end: number) => {
  const numbers = [];
  for (let i = start; i < end; i += 1) {
    numbers.push(buffer.readUInt8(i));
  }
  return numbers;
};

export const normalizeAudioData = (PCMData: number[]) =>
  PCMData.map(num => (num - 128) / 128);

export const spawnFfmpegAudioReader = (filename: string, format: string) => {
  if (!ffmpegPath) {
    throw new Error('ffmpeg path not found');
  }
  const ffmpegProcess = spawn(ffmpegPath, ['-i', filename, '-f', format, '-ac', '1', '-']);
  return ffmpegProcess;
};

export const createAudioBuffer = (filename: string, format: string) =>
  new Promise<{ audioBuffer: Buffer, sampleRate: number }>((resolve, reject) => {
    let sampleRate: number;
    const sampleRateRegExp = /(\d+) Hz/m;
    const audioBuffers: Buffer[] = [];
    const ffmpegAudioReader = spawnFfmpegAudioReader(filename, format);

    ffmpegAudioReader.stderr.on('data', function (data) {
      const match = data.toString().match(sampleRateRegExp);
      if (!sampleRate && match) {
        sampleRate = match[1];
      }
    });
    ffmpegAudioReader.stdout.on('data', function (chunkBuffer) {
      audioBuffers.push(chunkBuffer);
    });
    ffmpegAudioReader.stdout.on('end', function () {
      const audioBuffer = Buffer.concat(audioBuffers);
      resolve({ audioBuffer, sampleRate });
    });
  });

