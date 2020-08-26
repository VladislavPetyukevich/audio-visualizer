import { spawn } from 'child_process';
import ffmpeg from 'ffmpeg-static';
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

export const smoothValues = (spectrums: number[], prevSpectrums?: number[]) => {
  if (!prevSpectrums) {
    return spectrums;
  }
  const resultSpectrum: number[] = [];
  for(let i = 0; i < spectrums.length; i++) {
    const currValue = spectrums[i];
    const currPrevValue = prevSpectrums[i] || 0;
    const avgValue = (currValue + currPrevValue) / 2;
    resultSpectrum.push(avgValue);
  }
  return resultSpectrum;
};

export const createSpectrumsProcessor = (busesCount: number) => {
  let prevAudioDataNormalized: number[] = [];
  let prevPeaks: number[] = [];
  let prevSpectrums: number[] = [];
  const skipFrameIndex = 2;

  return (frameIndex: number, parseAudioData: () => number[]) => {
    const isFrameSkiped = 
      frameIndex && (frameIndex % skipFrameIndex === 0);
    const audioDataNomrmalized = isFrameSkiped ?
      prevAudioDataNormalized :
      normalizeAudioData(parseAudioData());
    prevAudioDataNormalized = audioDataNomrmalized;

    const spectrum = getSpectrum(audioDataNomrmalized);
    const skipIndex = Math.trunc(spectrum.length / busesCount);
    const spectrumReduced = spectrum.filter(skipEvery(skipIndex));
    const peaks = getPeaks(spectrumReduced, prevPeaks);
    const correctedSpectrum = correctPeaks(spectrumReduced, peaks);
    const smoothSpectrum = smoothValues(correctedSpectrum, prevSpectrums);
    prevSpectrums = smoothSpectrum;
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
  const ffmpegProcess = spawn(ffmpeg.path, ['-i', filename, '-f', format, '-ac', '1', '-']);
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

