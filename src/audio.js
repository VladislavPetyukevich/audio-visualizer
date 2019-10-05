const spawn = require('child_process').spawn;
const ffmpeg = require('ffmpeg-static');
const getFFT = require('./fft').getFFT;
const smooth = require('array-smooth');

const getSmoothBusesSequences = (audioData, framesCount, frequencyBuses, sampleRate) => {
  const audioDataStep = Math.trunc(audioData.length / framesCount);
  const busesSequences = {};
  frequencyBuses.forEach(
    (frequencyBus, index) => {
      if (index === frequencyBuses.length - 1) {
        return;
      }
      busesSequences[frequencyBus] = [];
    }
  );

  for (let i = 0; i < audioData.length; i += audioDataStep) {
    const normalizedAudioFrame = audioData.slice(i, i + audioDataStep);
    const fft = getFFT(normalizedAudioFrame, sampleRate);
    const buses = getFrequencyBuses(fft, frequencyBuses);
    Object.entries(buses).forEach(([bus, value]) => busesSequences[bus].push(value));
  }
  const smoothBusesSequences = {};
  Object.entries(busesSequences).forEach(
    ([bus, sequence]) => smoothBusesSequences[bus] = smooth(busesSequences[bus], 1)
  );
  return smoothBusesSequences;
};

const getFrequencyBuses = (FFTData, frequencyBuses) => {
  const result = {};
  frequencyBuses.forEach((bus, index) => {
    if (index === frequencyBuses.length - 1) {
      return;
    }
    result[bus] = 0
  });
  FFTData.forEach(data => {
    frequencyBuses.forEach((bus, index) => {
      const nextBus = frequencyBuses[index + 1];
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

const bufferToUInt8 = (buffer) => {
  if (!(buffer instanceof Buffer)) {
    throw new Error('Buffer argument is not instance of Buffer');
  }

  const numbers = [];
  for (let i = 0; i < buffer.length; i += 1) {
    numbers.push(buffer.readUInt8(i));
  }
  return numbers;
};

const normalizeAudioData = PCMData => PCMData.map(num => (num - 128) / 128);

const spawnFfmpegAudioReader = (filename, format) => {
  const ffmpegProcess = spawn(ffmpeg.path, ['-i', filename, '-f', format, '-ac', '1', '-']);
  return ffmpegProcess;
};

const createAudioBuffer = (filename, format) =>
  new Promise((resolve, reject) => {
    let sampleRate;
    const sampleRateRegExp = /(\d+) Hz/m;
    const audioBuffers = [];
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

module.exports = {
  bufferToUInt8,
  normalizeAudioData,
  createAudioBuffer,
  getFrequencyBuses,
  getSmoothBusesSequences
};
