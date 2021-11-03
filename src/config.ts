import path from 'path';
import { Config, PositionAliasName, RotationAliasName } from './index';

export const defaults = {
  fps: 60,
  spectrumWidth: 0.4,
  spectrumHeight: 0.1,
  spectrumX: 'center',
  spectrumY: 'top',
  spectrumRotation: 'down'
};

type RelativePositionValue = 0 | 0.5 | 1;

interface PositionAlias {
  name: PositionAliasName;
  value: RelativePositionValue;
}

const postitionAliases: PositionAlias[] = [
  { name: 'left', value: 0 },
  { name: 'center', value: 0.5 },
  { name: 'right', value: 1 },
  { name: 'top', value: 0 },
  { name: 'middle', value: 0.5 },
  { name: 'bottom', value: 1 },
];

export const rotationAliasValues = ['up', 'down'] as const;

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

const getSpectrumX = (config: Config) =>
  parseNumberIfPossible(
    (config.outVideo.spectrum && config.outVideo.spectrum.x) ||
    defaults.spectrumX
  );

const getSpectrumY = (config: Config) =>
  parseNumberIfPossible(
    (config.outVideo.spectrum && config.outVideo.spectrum.y) ||
    defaults.spectrumY
  );

const parseNumberIfPossible = (value: string | number) => {
  const parsed = Number(value);
  if (isNaN(parsed)) {
    return value;
  }
  return parsed;
};

const parsePositionAlias = (aliasName: string): PositionAlias => {
  const nameNormalized = aliasName.trim().toLowerCase();
  const alias = postitionAliases.find(
    als => als.name === nameNormalized
  );
  if (!alias) {
    throw new Error();
  }
  return alias;
};

const getValidPositionAliasValues = () =>
  postitionAliases.map(aliasEl => aliasEl.name).join(', ');

const getSpectrumAbsolutePosition = (
  relativePosition: RelativePositionValue,
  spectrumSize: number,
  backgroundImageSize: number
) => {
  switch (relativePosition) {
    case 0:
      return 0;
    case 0.5:
      return relativePosition * backgroundImageSize - spectrumSize / 2;
    case 1:
      return relativePosition * backgroundImageSize - spectrumSize;
    default:
      throw new Error();
  }
};

export const getSpectrumXAbsolute = (
  config: Config,
  spectrumWidth: number,
  backgroundImageWidth: number
) => {
  const spectrumX = getSpectrumX(config);
  if (typeof spectrumX !== 'string') {
    return spectrumX;
  }
  try {
    const spectrumXParsed = parsePositionAlias(spectrumX);
    return getSpectrumAbsolutePosition(
      spectrumXParsed.value,
      spectrumWidth,
      backgroundImageWidth
    );
  } catch {
    throw new Error(`Invalid spectrum x value: ${spectrumX}. Valid values: ${getValidPositionAliasValues()}.`);
  }
};

export const getSpectrumYAbsolute = (
  config: Config,
  spectrumHeight: number,
  backgroundImageHeight: number
) => {
  const spectrumY = getSpectrumY(config);
  if (typeof spectrumY !== 'string') {
    return spectrumY;
  }
  try {
    const spectrumXParsed = parsePositionAlias(spectrumY);
    return getSpectrumAbsolutePosition(
      spectrumXParsed.value,
      spectrumHeight,
      backgroundImageHeight
    );
  } catch {
    throw new Error(`Invalid spectrum y value: ${spectrumY}. Valid values: ${getValidPositionAliasValues()}.`);
  }
};

const getValidRotationAliasValues = () =>
  rotationAliasValues.join(', ');

export const checkIsValidRotationAlias = (aliasName: string) => {
  return !!rotationAliasValues.find(al => al === aliasName);
};

export const getSpectrumRotation = (config: Config): RotationAliasName => {
  const rotationValue =
    (config.outVideo.spectrum && config.outVideo.spectrum.rotation) ||
    defaults.spectrumRotation;
  if (!checkIsValidRotationAlias(rotationValue)) {
    throw new Error(`Invalid spectrum rotation value: ${rotationValue}. Valid values: ${getValidRotationAliasValues}.`);
  }
  return rotationValue as RotationAliasName;
};

export const getSpectrumColor = (config: Config) =>
  (config.outVideo.spectrum && config.outVideo.spectrum.color);

export const getFfmpeg_cfr = (config: Config) =>
  config.tweaks && config.tweaks.ffmpeg_cfr;

export const getFfmpeg_preset = (config: Config) =>
  config.tweaks && config.tweaks.ffmpeg_preset;

export const getFrame_processing_delay = (config: Config) =>
  config.tweaks && config.tweaks.frame_processing_delay;

