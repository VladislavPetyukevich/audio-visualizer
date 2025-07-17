import path from 'path';
import { Config, SpectrumSizeValue, PositionAliasName, RotationAliasName } from './index';

export const defaults = {
  fps: 30,
  spectrumWidth: '33%',
  spectrumHeight: 80 * 2,
  spectrumX: 'center',
  spectrumY: 'middle',
  spectrumRotation: 'up',
  // spectrumRotation: 'mirror',
  spectrumBusesCount: 64,
  spectrumBusMargin: 12,
  spectrumOpacity: '80%',
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

export const rotationAliasValues = ['up', 'down', 'mirror'] as const;

export const checkIsPercentValue = (value: string) =>
  RegExp(/\d+%/).test(value)

export const getAudioFilePath = (config: Config) =>
  path.resolve(config.audio.path);

export const getBackgroundImagePath = (config: Config) =>
  path.resolve(config.image.path);

export const getOutVideoPath = (config: Config) =>
  path.resolve(config.outVideo.path);

export const getFPS = (config: Config) =>
  config.outVideo.fps || defaults.fps;

export const getSpectrumBusesCount = () => defaults.spectrumBusesCount;

export const getSpectrumBusMargin = () => defaults.spectrumBusMargin;

const getSpectrumWidth = (config: Config) =>
  (config.outVideo.spectrum && config.outVideo.spectrum.width) ||
  defaults.spectrumWidth;

const getSpectrumSizeAbsolute = (
  spectrumSize: SpectrumSizeValue,
  backgroundImageSize: number,
  fieldName: string
) => {
  if (typeof spectrumSize === 'number') {
    return spectrumSize;
  }
  const isPercentValue = checkIsPercentValue(spectrumSize);
  if (!isPercentValue) {
    throw new Error(getSpectrumSizeValueErrorMessage(fieldName, spectrumSize));
  }
  const percentValue = parseInt(spectrumSize) / 100;
  return backgroundImageSize * percentValue;
};

const getSpectrumSizeValueErrorMessage = (
  fieldName: string, value: SpectrumSizeValue
) =>
  `Invalid spectrum ${fieldName} value: '${value}'. Use number value or percent value in string, for example: '30%'.`

export const getSpectrumWidthAbsolute = (
  config: Config, backgroundImageWidth: number
) => {
  const spectrumWidth = getSpectrumWidth(config);
  const spectrumWidthAbsolute = getSpectrumSizeAbsolute(spectrumWidth, backgroundImageWidth, 'width');
  const spectrumWidthWithoutMargin =
    Math.trunc(spectrumWidthAbsolute / defaults.spectrumBusesCount) - defaults.spectrumBusMargin / 2;
  if (spectrumWidthWithoutMargin <= 0) {
    throw new Error(`Spectrum width '${spectrumWidth}' is too small.`);
  }
  return spectrumWidthAbsolute;
};

const getSpectrumHeight = (config: Config) =>
  (config.outVideo.spectrum && config.outVideo.spectrum.height) ||
  defaults.spectrumHeight;

export const getSpectrumHeightAbsolute = (
  config: Config, backgroundImageHeight: number
) => {
  const spectrumHeight = getSpectrumHeight(config);
  return getSpectrumSizeAbsolute(spectrumHeight, backgroundImageHeight, 'height');
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
  config.outVideo.spectrum && config.outVideo.spectrum.color;

export const getSpectrumOpacity = (config: Config) =>
  (config.outVideo.spectrum && config.outVideo.spectrum.opacity) ||
  defaults.spectrumOpacity;

export const getSpectrumOpacityParsed = (config: Config) => {
  const spectrumOpacity = getSpectrumOpacity(config);
  if (!checkIsPercentValue(spectrumOpacity)) {
    throw new Error(`Invalid spectrum opacity value: '${spectrumOpacity}'. Use string percent value, for example '80%'.`);
  }
  const percentValue = parseInt(spectrumOpacity);
  if (
    (percentValue < 0) ||
    (percentValue > 100)
  ) {
    throw new Error(`Invalid spectrum opacity value: '${spectrumOpacity}'. Percent values must be in range from '0%' to '100%'.`);
  }
  return percentValue / 100;
};

export const getFfmpeg_cfr = (config: Config) =>
  config.tweaks && config.tweaks.ffmpeg_cfr;

export const getFfmpeg_preset = (config: Config) =>
  config.tweaks && config.tweaks.ffmpeg_preset;

export const getFrame_processing_delay = (config: Config) =>
  config.tweaks && config.tweaks.frame_processing_delay;

