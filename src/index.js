const path = require('path');
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

(async () => {
  const audioBuffer = await createAudioBuffer(filePath, FFMPEG_FORMAT);
  const audioData = PCM_FORMAT.parseFunction(audioBuffer);
  const normalizedAudioData = normalizeAudioData(audioData);
  console.log('normalizedAudioData: ', normalizedAudioData);
})();
