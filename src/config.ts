import path from 'path';
import { Config } from './index';

export const defaults = {
  fps: 60,
  spectrumWidth: 0.4,
  spectrumHeight: 0.1
};

const checkIsInt = (num: number) =>
  num % 1 === 0;

export const getAudioFilePath = (config: Config) =>
  path.resolve(config.audio.path);

export const getBackgroundImagePath = (config: Config) =>
  path.resolve(config.image.path);

export const getOutVideoPath = (config: Config) =>
  path.resolve(config.outVideo.path);

export const getFPS = (config: Config) =>
  config.outVideo.fps || defaults.fps;

const getSpectrumWidth = (config: Config) =>
  (config.outVideo.spectrum && config.outVideo.spectrum.width) ||
  defaults.spectrumWidth;

export const getSpectrumWidthAbsolute = (
  config: Config, backgroundImageWidth: number
) => {
  const spectrumWidth = getSpectrumWidth(config);
  const isAbsoluteValue = checkIsInt(spectrumWidth);
  if (isAbsoluteValue) {
    return spectrumWidth;
  }
  return backgroundImageWidth * spectrumWidth;
};

const getSpectrumHeight = (config: Config) =>
  (config.outVideo.spectrum && config.outVideo.spectrum.height) ||
  defaults.spectrumHeight;

export const getSpectrumHeightAbsolute = (
  config: Config, backgroundImageHeight: number
) => {
  const spectrumHeight = getSpectrumHeight(config);
  const isAbsoluteValue = checkIsInt(spectrumHeight);
  if (isAbsoluteValue) {
    return spectrumHeight;
  }
  return backgroundImageHeight * spectrumHeight;
};

export const getSpectrumColor = (config: Config) =>
  (config.outVideo.spectrum && config.outVideo.spectrum.color);

export const getFfmpeg_cfr = (config: Config) =>
  config.tweaks && config.tweaks.ffmpeg_cfr;

export const getFfmpeg_preset = (config: Config) =>
  config.tweaks && config.tweaks.ffmpeg_preset;

export const getFrame_processing_delay = (config: Config) =>
  config.tweaks && config.tweaks.frame_processing_delay;

