const path = require('path');
const fs = require('fs');
const createAudioBuffer = require('./audio').createAudioBuffer;
const bufferToUInt8 = require('./audio').bufferToUInt8;
const normalizeAudioData = require('./audio').normalizeAudioData;

const PCM_FORMAT = {
  bit: 8,
  sign: 'u',
  parseFunction: bufferToUInt8
};
const FFMPEG_FORMAT = `${PCM_FORMAT.sign}${PCM_FORMAT.bit}`;
const filePath = path.resolve('media/sample_noise.wav');
const backgroundImagePath = path.resolve('media/background.png');
const SAMPLE_RATE = 44100;
const FPS = 20;

(async () => {
  const backgroundImageBuffer = fs.readFileSync(backgroundImagePath);
  const audioBuffer = await createAudioBuffer(filePath, FFMPEG_FORMAT);
  const audioData = PCM_FORMAT.parseFunction(audioBuffer);
  const normalizedAudioData = normalizeAudioData(audioData);

  const audioDuration = audioData.length / SAMPLE_RATE;
  const framesCount = Math.trunc(audioDuration * FPS + audioDuration * FPS / 4);
  console.log('framesCount: ', framesCount);
  const audioDataStep = Math.trunc(audioData.length / framesCount);
  console.log('audioDataStep: ', audioDataStep);
})();
