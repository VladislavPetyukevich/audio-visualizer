import { spawn } from 'child_process';
import ffmpeg from 'ffmpeg-static';
import { getFFT } from './fft';
import smooth from 'array-smooth';

interface BusesSequences {
  [frequencyBus: number]: number[];
}

export interface FrequencyBuses {
  [bus: number]: number;
}

export const getSmoothBusesSequences = (audioData: number[], framesCount: number, frequencyBusesNames: number[], sampleRate: number) => {
  const audioDataStep = Math.trunc(audioData.length / framesCount);
  const busesSequences: BusesSequences = {};
  frequencyBusesNames.forEach(
    (frequencyBus, index) => {
      if (index === frequencyBusesNames.length - 1) {
        return;
      }
      busesSequences[frequencyBus] = [];
    }
  );

  for (let i = 0; i < audioData.length; i += audioDataStep) {
    const normalizedAudioFrame = audioData.slice(i, i + audioDataStep);
    const fft = getFFT(normalizedAudioFrame, sampleRate);
    const buses = ffftDataToBusesSequences(fft, frequencyBusesNames);
    Object.entries(buses).forEach(([bus, value]) => busesSequences[+bus].push(value));
  }
  const smoothBusesSequences: BusesSequences = {};
  Object.entries(busesSequences).forEach(
    ([bus, sequence]) => smoothBusesSequences[+bus] = smooth(busesSequences[+bus], 1)
  );
  return smoothBusesSequences;
};

export const ffftDataToBusesSequences = (FFTData: Array<{ frequency: number, magnitude: number }>, frequencyBusesNames: number[]) => {
  const result: FrequencyBuses = {};
  frequencyBusesNames.forEach((bus, index) => {
    if (index === frequencyBusesNames.length - 1) {
      return;
    }
    result[bus] = 0
  });
  FFTData.forEach(data => {
    frequencyBusesNames.forEach((bus, index) => {
      const nextBus = frequencyBusesNames[index + 1];
      if (!nextBus) {
        return;
      }
      if ((data.frequency >= bus) && (data.frequency < nextBus)) {
        result[bus] = (result[bus]) ? (result[bus] + data.magnitude) / 2 : data.magnitude;
      }
    });

  });

  return result;
};

export const bufferToUInt8 = (buffer: Buffer) => {
  if (!(buffer instanceof Buffer)) {
    throw new Error('Buffer argument is not instance of Buffer');
  }

  const numbers = [];
  for (let i = 0; i < buffer.length; i += 1) {
    numbers.push(buffer.readUInt8(i));
  }
  return numbers;
};

export const normalizeAudioData = (PCMData: number[]) => PCMData.map(num => (num - 128) / 128);

const spawnFfmpegAudioReader = (filename: string, format: string) => {
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
