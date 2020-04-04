import path from 'path';
import { createAudioBuffer, bufferToUInt8, normalizeAudioData, getSmoothSpectrums, skipEvery } from './audio';
import { parseImage, createVisualizerFrame, createImageBuffer, getImageColor, invertColor, Color, convertToBmp } from './image';
import { spawnFfmpegVideoWriter, getProgress, calculateProgress, waitDrain } from './video';

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

    const backgroundImageBmpBuffer = await convertToBmp(backgroundImagePath);
    const backgroundImage = parseImage(backgroundImageBmpBuffer);
    const audioReader = await createAudioBuffer(audioFilePath, FFMPEG_FORMAT);
    const audioBuffer = audioReader.audioBuffer;
    const sampleRate = audioReader.sampleRate;
    if (!sampleRate) {
      throw new Error('ffmpeg didn\'t show audio sample rate');
    }
    const audioData = PCM_FORMAT.parseFunction(audioBuffer);
    const normalizedAudioData = normalizeAudioData(audioData);

    const FPS = config.outVideo.fps || 60;
    const spectrumWidth =
      (config.outVideo.spectrum && config.outVideo.spectrum.width) ||
      backgroundImage.width * 0.4;
    const spectrumHeight =
      (config.outVideo.spectrum && config.outVideo.spectrum.height) ||
      backgroundImage.height * 0.1;
    const spectrumColor =
      (config.outVideo.spectrum && config.outVideo.spectrum.color) ||
      invertColor(getImageColor(backgroundImage));

    const audioDuration = audioData.length / sampleRate;
    const framesCount = Math.trunc(audioDuration * FPS);
    const audioDataStep = Math.trunc(audioData.length / framesCount);
    const spectrums = getSmoothSpectrums(normalizedAudioData, FPS, audioDataStep);
    const spectrumsReduced = spectrums.map(spectrum => spectrum.filter(skipEvery(4)));

    const ffmpegVideoWriter = spawnFfmpegVideoWriter({
      audioFilename: audioFilePath,
      videoFileName: outVideoPath,
      fps: FPS,
      ...(!!onProgress && { onStderr: getProgress(calculateProgress(framesCount + 1, onProgress)) })
    });
    ffmpegVideoWriter.on('exit', (code: number) => resolve(code));

    for (let i = 0; i < framesCount; i++) {
      const frameImage = createVisualizerFrame(
        backgroundImage,
        spectrumsReduced[i],
        { width: spectrumWidth, height: spectrumHeight },
        spectrumColor
      );
      const frameImageBuffer = createImageBuffer(frameImage);
      const isFrameProcessed = ffmpegVideoWriter.stdin.write(frameImageBuffer);
      if (!isFrameProcessed) {
        await waitDrain(ffmpegVideoWriter.stdin);
      }
    }

    ffmpegVideoWriter.stdin.end();
  });
