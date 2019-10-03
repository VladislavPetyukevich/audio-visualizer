const path = require('path');
const fs = require('fs');
const createAudioBuffer = require('./audio').createAudioBuffer;
const bufferToUInt8 = require('./audio').bufferToUInt8;
const normalizeAudioData = require('./audio').normalizeAudioData;
const getSmoothBusesSequences = require('./audio').getSmoothBusesSequences;
const createVisualizerFrame = require('./image').createVisualizerFrame;
const createImageBuffer = require('./image').createImageBuffer;
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
  const SAMPLE_RATE = config.audio.sampleRate;
  const FPS = config.outVideo.fps;
  const frequencyBuses =
    (config.outVideo.spectrum && config.outVideo.spectrum.frequencyBuses) ||
    [0, 100, 200, 500, 1000, 2000, 3000, 5000, 10000];
  const frequencyBusesHeight =
    (config.outVideo.spectrum && config.outVideo.spectrum.height) ||
    300;

  const backgroundImageBuffer = fs.readFileSync(backgroundImagePath);
  const audioBuffer = await createAudioBuffer(audioFilePath, FFMPEG_FORMAT);
  const audioData = PCM_FORMAT.parseFunction(audioBuffer);
  const normalizedAudioData = normalizeAudioData(audioData);
  const ffmpegVideoWriter = spawnFfmpegVideoWriter(audioFilePath, outVideoPath, FPS);
  ffmpegVideoWriter.on('exit', code => resolve(code));

  const audioDuration = audioData.length / SAMPLE_RATE;
  const framesCount = Math.trunc(audioDuration * FPS);
  const smoothBusesSequences = getSmoothBusesSequences(normalizedAudioData, framesCount, frequencyBuses, SAMPLE_RATE);

  for (let i = 0; i < framesCount; i++) {
    const buses = {};
    Object.keys(smoothBusesSequences).forEach(bus => buses[bus] = smoothBusesSequences[bus][i]);
    const frameImage = await createVisualizerFrame(backgroundImageBuffer, buses, frequencyBusesHeight);
    const frameImageBuffer = await createImageBuffer(frameImage);
    ffmpegVideoWriter.stdin.write(frameImageBuffer);
  }

  ffmpegVideoWriter.stdin.end();
});

module.exports = renderAudioVisualizer;
