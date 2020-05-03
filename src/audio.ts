/// <reference path="./vendor-typings/array-smooth.d.ts"/>
import { spawn } from 'child_process';
import ffmpeg from 'ffmpeg-static';
import { getSpectrum } from './dsp';
import smooth from 'array-smooth';

export const skipEvery = <T>(skipIndex: number) => (element: T, index: number) =>
  (index % skipIndex === 0) ? element : null;

export const getSmoothBuses = (busValues: number[]) =>
  smooth(busValues, 2);

export const smoothSpectrums = (spectrums: number[][], FPS: number) => {
  const scaleValues = (values: number[]) => {
    const maxValue = Math.max.apply(null, values);
    return values.map(value => value / maxValue);
  };
  const lengths = spectrums.map(spectrum => spectrum.length);
  const maxLength = Math.max.apply(null, lengths);
  const buses: number[][] = [];
  for (let bus = 0; bus < maxLength; bus++) {
    buses[bus] = [];
  }

  spectrums.forEach((spectrum) => {
    for (let bus = 0; bus < maxLength; bus++) {
      buses[bus].push(spectrum[bus] || 0);
    }
  });

  const smoothBuses = buses.map(bus => getSmoothBuses(scaleValues(bus)));
  const smoothSpectrums: number[][] = [];
  for (let spectrumIndex = 0; spectrumIndex < spectrums.length; spectrumIndex++) {
    smoothSpectrums[spectrumIndex] = [];
  }

  for (let spectrumIndex = 0; spectrumIndex < spectrums.length; spectrumIndex++) {
    for (let bus = 0; bus < maxLength; bus++) {
      smoothSpectrums[spectrumIndex].push(smoothBuses[bus][spectrumIndex]);
    }
  }
  return smoothSpectrums;
};

export const getSmoothSpectrums = (audioData: number[], FPS: number, audioDataStep: number) => {
  const spectrums: number[][] = [];
  for (let i = 0; i < audioData.length; i += audioDataStep) {
    const normalizedAudioFrame = audioData.slice(i, i + audioDataStep);
    const spectrum = getSpectrum(normalizedAudioFrame);

    spectrums.push(spectrum);
  }

  return smoothSpectrums(spectrums, FPS);
};

export const bufferToUInt8 = (buffer: Buffer) => {
  const numbers = [];
  for (let i = 0; i < buffer.length; i += 1) {
    numbers.push(buffer.readUInt8(i));
  }
  return numbers;
};

export const normalizeAudioData = (PCMData: number[]) => PCMData.map(num => (num - 128) / 128);

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
