const path = require('path');
const createAudioBuffer = require('./audio').createAudioBuffer;

const PCM_FORMAT = {
  bit: 8,
  sign: 'u'
};
const FFMPEG_FORMAT = `${PCM_FORMAT.sign}${PCM_FORMAT.bit}`;
const filePath = path.resolve('media/sample_noise.wav');

(async () => {
  const audioBuffer = await createAudioBuffer(filePath, FFMPEG_FORMAT);
  console.log('audioBuffer: ', audioBuffer);
})();
