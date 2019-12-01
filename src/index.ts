import path from 'path';
import fs from 'fs';
import { FrequencyBuses, createAudioBuffer, bufferToUInt8, normalizeAudioData, getSmoothBusesSequences } from './audio';
import { createVisualizerFrame, parseImage, createImageBuffer, getImageColor, invertColor, Color } from './image';
import { spawnFfmpegVideoWriter, getProgress, calculateProgress } from './video';

export const PCM_FORMAT = {
  bit: 8,
  sign: 'u',
  parseFunction: bufferToUInt8
};
const FFMPEG_FORMAT = `${PCM_FORMAT.sign}${PCM_FORMAT.bit}`;

export interface Config {
  audio: {
    path: string
  };
  image: {
    path: string;
  };
  outVideo: {
    path: string;
    fps?: number;
    spectrum?: {
      frequencyBuses?: number[];
      width?: number;
      height?: number;
      color?: Color | string;
    }
  }
}

export const renderAudioVisualizer = (config: Config, onProgress?: (progress: number) => any) =>
  new Promise<number>(async (resolve) => {
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
      [0, 100, 200, 500, 1000, 1500, 2000, 3000, 5000, 10000];
    const frequencyBusesWidth =
      (config.outVideo.spectrum && config.outVideo.spectrum.width) ||
      backgroundImage.width * 0.3;
    const frequencyBusesHeight =
      (config.outVideo.spectrum && config.outVideo.spectrum.height) ||
      backgroundImage.height * 0.3;
    const frequencyBusesColor =
      (config.outVideo.spectrum && config.outVideo.spectrum.color) ||
      invertColor(await getImageColor(backgroundImagePath));

    const audioDuration = audioData.length / sampleRate;
    const framesCount = Math.trunc(audioDuration * FPS);
    const smoothBusesSequences = getSmoothBusesSequences(normalizedAudioData, framesCount, frequencyBuses, sampleRate);

    const ffmpegVideoWriter = spawnFfmpegVideoWriter({
      audioFilename: audioFilePath,
      videoFileName: outVideoPath,
      fps: FPS,
      ...(!!onProgress && { onStderr: getProgress(calculateProgress(framesCount + 1, onProgress)) })
    });
    ffmpegVideoWriter.on('exit', (code: number) => resolve(code));

    for (let i = 0; i < framesCount; i++) {
      const buses: FrequencyBuses = {};
      Object.keys(smoothBusesSequences).forEach(bus => buses[+bus] = smoothBusesSequences[+bus][i]);
      const frameImage = await createVisualizerFrame(
        backgroundImageBuffer,
        buses,
        { width: frequencyBusesWidth, height: frequencyBusesHeight },
        frequencyBusesColor
      );
      const frameImageBuffer = await createImageBuffer(frameImage);
      ffmpegVideoWriter.stdin.write(frameImageBuffer);
    }

    ffmpegVideoWriter.stdin.end();
  });
