const path = require('path');
const fs = require('fs');
const createAudioBuffer = require('./audio').createAudioBuffer;
const bufferToUInt8 = require('./audio').bufferToUInt8;
const normalizeAudioData = require('./audio').normalizeAudioData;
const getFrequencyBuses = require('./audio').getFrequencyBuses;
const createVisualizerFrame = require('./image').createVisualizerFrame;
const createImageBuffer = require('./image').createImageBuffer;
const spawnFfmpegVideoWriter = require('./video').spawnFfmpegVideoWriter;
const getFFT = require('./fft').getFFT;

const PCM_FORMAT = {
  bit: 8,
  sign: 'u',
  parseFunction: bufferToUInt8
};
const FFMPEG_FORMAT = `${PCM_FORMAT.sign}${PCM_FORMAT.bit}`;
const audioFilePath = path.resolve('media/sample_noise.wav');
const backgroundImagePath = path.resolve('media/background.png');
const outVideoPath = path.resolve('media/out.mp4');
const SAMPLE_RATE = 44100;
const FPS = 20;

(async () => {
  const frequencyBuses = [0, 50, 100, 200, 500, 1000, 2000, 3000, 5000, 10000];
  const backgroundImageBuffer = fs.readFileSync(backgroundImagePath);
  const audioBuffer = await createAudioBuffer(audioFilePath, FFMPEG_FORMAT);
  const audioData = PCM_FORMAT.parseFunction(audioBuffer);
  const normalizedAudioData = normalizeAudioData(audioData);
  const ffmpegVideoWriter = spawnFfmpegVideoWriter(audioFilePath, outVideoPath, FPS);

  const audioDuration = audioData.length / SAMPLE_RATE;
  const framesCount = Math.trunc(audioDuration * FPS + audioDuration * FPS / 4);
  console.log('framesCount: ', framesCount);
  const audioDataStep = Math.trunc(audioData.length / framesCount);
  console.log('audioDataStep: ', audioDataStep);

  for (let i = 0; i < audioData.length; i += audioDataStep) {
    const normalizedAudioFrame = normalizedAudioData.slice(i, i + audioDataStep);
    const fft = getFFT(normalizedAudioFrame, SAMPLE_RATE);
    const buses = getFrequencyBuses(fft, frequencyBuses);
    const frameImage = await createVisualizerFrame(backgroundImageBuffer, buses);
    const frameImageBuffer = await createImageBuffer(frameImage);
    ffmpegVideoWriter.stdin.write(frameImageBuffer);
  }

  ffmpegVideoWriter.stdin.end();
  console.log('end');
})();
