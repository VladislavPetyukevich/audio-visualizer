import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { FREQUENCY_BANDS, getSpectrum } from './dsp';

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

const oldMax = 1;
const newMin = 0.6;
const getInterpolationFactor = (skippedFramesCount: number, skipFramesCount: number) => {
  const interpolationFactor = 1 - (skippedFramesCount / skipFramesCount);
  const interpolationFactorInRange = (interpolationFactor * (oldMax - newMin)) + newMin;
  return interpolationFactorInRange;
};

export const createSpectrumsProcessor = (sampleRate: number, skipFramesCount: number) => {
  let prevAudioDataNormalized: number[] = [];
  let prevPeaks: number[] = [];
  let skippedFramesCount = 0;
  let targetSpectrum: number[] = [];
  let previousSpectrum: number[] = [];

  return (parseAudioData: () => number[]) => {
    if (skippedFramesCount === 0) {
      skippedFramesCount = skipFramesCount;
      const audioDataNomrmalized = normalizeAudioData(parseAudioData());
      prevAudioDataNormalized = audioDataNomrmalized;

      const spectrum = getSpectrum(audioDataNomrmalized, sampleRate);
      const peaks = getPeaks(spectrum, prevPeaks);
      const correctedSpectrum =
        prevPeaks.length === 0 ?
          Array(FREQUENCY_BANDS.length).fill(0) :
          correctPeaks(spectrum, peaks);
     
      prevPeaks = peaks;
      previousSpectrum = [...targetSpectrum];
      targetSpectrum = correctedSpectrum;
    } else {
      skippedFramesCount--;
    }
    const interpolationFactor = getInterpolationFactor(skippedFramesCount, skipFramesCount);
    const interpolatedSpectrum = targetSpectrum.map((target, i) => {
      const prev = previousSpectrum[i] || target;
      return prev + (target - prev) * interpolationFactor;
    });
    return interpolatedSpectrum;
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

