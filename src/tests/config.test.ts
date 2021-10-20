import path from 'path';
import { expect } from 'chai';
import { Config } from '../index';
import {
  defaults,
  getAudioFilePath,
  getBackgroundImagePath,
  getOutVideoPath,
  getFPS,
  getSpectrumWidthAbsolute,
  getSpectrumHeightAbsolute,
  getSpectrumColor,
  getFfmpeg_cfr,
  getFfmpeg_preset,
  getFrame_processing_delay
} from '../config';

describe('config', function() {
  it('getAudioFilePath', function() {
    const result = getAudioFilePath({
      audio: { path: 'test/path' }
    } as Config);
    const expected = path.resolve('test/path');
    expect(result).equal(expected);
  });

  it('getBackgroundImagePath', function() {
    const result = getBackgroundImagePath({
      image: { path: 'test/path' }
    } as Config);
    const expected = path.resolve('test/path');
    expect(result).equal(expected);
  });

  it('getOutVideoPath', function() {
    const result = getOutVideoPath({
      outVideo: { path: 'test/path' }
    } as Config);
    const expected = path.resolve('test/path');
    expect(result).equal(expected);
  });

  it('getFPS', function() {
    const result1 = getFPS({
      outVideo: {}
    } as Config);
    expect(result1).equal(defaults.fps);

    const result2 = getFPS({
      outVideo: { fps: 15 }
    } as Config);
    expect(result2).equal(15);
  });

  it('getSpectrumWidthAbsolute', function() {
    const backgroundImageWidth = 1366;
    const result1 = getSpectrumWidthAbsolute({
      outVideo: {}
    } as Config, backgroundImageWidth);
    expect(result1).equal(
      backgroundImageWidth * defaults.spectrumWidth
    );

    const result2 = getSpectrumWidthAbsolute({
      outVideo: { spectrum: { width: 420 }}
    } as Config, backgroundImageWidth);
    expect(result2).equal(420);

    const result3 = getSpectrumWidthAbsolute({
      outVideo: { spectrum: { width: 0.69 }}
    } as Config, backgroundImageWidth);
    expect(result3).equal(backgroundImageWidth * 0.69);
  });

  it('getSpectrumHeightAbsolute', function() {
    const backgroundImageHeight = 768;
    const result1 = getSpectrumHeightAbsolute({
      outVideo: {}
    } as Config, backgroundImageHeight);
    expect(result1).equal(
      backgroundImageHeight * defaults.spectrumHeight
    );

    const result2 = getSpectrumHeightAbsolute({
      outVideo: { spectrum: { height: 420 }}
    } as Config, backgroundImageHeight);
    expect(result2).equal(420);

    const result3 = getSpectrumHeightAbsolute({
      outVideo: { spectrum: { height: 0.69 }}
    } as Config, backgroundImageHeight);
    expect(result3).equal(backgroundImageHeight * 0.69);
  });

  it('getSpectrumColor', function() {
    const result1 = getSpectrumColor({
      outVideo: {}
    } as Config);
    expect(result1).equal(undefined);

    const result2 = getSpectrumColor({
      outVideo: { spectrum: { color: '#cccc99' } }
    } as Config);
    expect(result2).equal('#cccc99');
  });

  it('getFfmpeg_cfr', function() {
    const result1 = getFfmpeg_cfr({
      tweaks: {}
    } as Config);
    expect(result1).equal(undefined);

    const result2 = getFfmpeg_cfr({
      tweaks: { ffmpeg_cfr: '69' }
    } as Config);
    expect(result2).equal('69');
  });

  it('getFfmpeg_preset', function() {
    const result1 = getFfmpeg_preset({
      tweaks: {}
    } as Config);
    expect(result1).equal(undefined);

    const result2 = getFfmpeg_preset({
      tweaks: { ffmpeg_preset: 'quality' }
    } as Config);
    expect(result2).equal('quality');
  });

  it('getFrame_processing_delay', function() {
    const result1 = getFrame_processing_delay({
      tweaks: {}
    } as Config);
    expect(result1).equal(undefined);

    const result2 = getFrame_processing_delay({
      tweaks: { frame_processing_delay: 420 }
    } as Config);
    expect(result2).equal(420);
  });
});
