const path = require('path');
const fs = require('fs');
const createAudioBuffer = require('./audio').createAudioBuffer;
const bufferToUInt8 = require('./audio').bufferToUInt8;
const normalizeAudioData = require('./audio').normalizeAudioData;
const getSmoothBusesSequences = require('./audio').getSmoothBusesSequences;
const createVisualizerFrame = require('./image').createVisualizerFrame;
const parseImage = require('./image').parseImage;
const createImageBuffer = require('./image').createImageBuffer;
const getImageColor = require('./image').getImageColor;
const invertColor = require('./image').invertColor;
const spawnFfmpegVideoWriter = require('./video').spawnFfmpegVideoWriter;

const PCM_FORMAT = {
  bit: 8,
  sign: 'u',
  parseFunction: bufferToUInt8
};
const FFMPEG_FORMAT = `${PCM_FORMAT.sign}${PCM_FORMAT.bit}`;

const renderAudioVisualizer = (config) => new Promise(async (resolve) => {
  const audioFilePath = path.resolve(config.audio.path);
  const backgroundImagePath = path.resolve(config.image.path);
  const outVideoPath = path.resolve(config.outVideo.path);

  const backgroundImageBuffer = fs.readFileSync(backgroundImagePath);
  const backgroundImage = await parseImage(backgroundImageBuffer);
  const audioReader = await createAudioBuffer(audioFilePath, FFMPEG_FORMAT);
  const audioBuffer = audioReader.audioBuffer;
  const sampleRate = audioReader.sampleRate;
  if (!sampleRate) {
    throw new Error('ffmpeg didn\'t show audio sample rate');
  }
  const audioData = PCM_FORMAT.parseFunction(audioBuffer);
  const normalizedAudioData = normalizeAudioData(audioData);

  const FPS = config.outVideo.fps || 60;
  const frequencyBuses =
    (config.outVideo.spectrum && config.outVideo.spectrum.frequencyBuses) ||
    [0, 100, 200, 500, 1000, 2000, 3000, 5000, 10000];
  const frequencyBusesWidth =
    (config.outVideo.spectrum && config.outVideo.spectrum.width) ||
    backgroundImage.width * 0.3;
  const frequencyBusesHeight =
    (config.outVideo.spectrum && config.outVideo.spectrum.height) ||
    backgroundImage.height * 0.3;
  const frequencyBusesColor =
    (config.outVideo.spectrum && config.outVideo.spectrum.color) ||
    invertColor(await getImageColor(backgroundImagePath));

  const ffmpegVideoWriter = spawnFfmpegVideoWriter(audioFilePath, outVideoPath, FPS);
  ffmpegVideoWriter.on('exit', code => resolve(code));

  const audioDuration = audioData.length / sampleRate;
  const framesCount = Math.trunc(audioDuration * FPS);
  const smoothBusesSequences = getSmoothBusesSequences(normalizedAudioData, framesCount, frequencyBuses, sampleRate);

  for (let i = 0; i < framesCount; i++) {
    const buses = {};
    Object.keys(smoothBusesSequences).forEach(bus => buses[bus] = smoothBusesSequences[bus][i]);
    const frameImage = await createVisualizerFrame(backgroundImageBuffer, buses, frequencyBusesWidth, frequencyBusesHeight, frequencyBusesColor);
    const frameImageBuffer = await createImageBuffer(frameImage);
    ffmpegVideoWriter.stdin.write(frameImageBuffer);
  }

  ffmpegVideoWriter.stdin.end();
});

module.exports = renderAudioVisualizer;
