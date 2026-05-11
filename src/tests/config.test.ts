import path from 'path';
import { expect } from 'chai';
import { Config } from '../index';
import {
  defaults,
  getAudioFilePath,
  getAudioAutoHighlight,
  getAudioAutoHighlightCount,
  getBackgroundImagePath,
  getOutVideoPath,
  getSubtitleRenderSpec,
  subtitleAlignmentToAss,
  getFPS,
  getSpectrumWidthAbsolute,
  getSpectrumHeightAbsolute,
  getSpectrumXAbsolute,
  getSpectrumYAbsolute,
  getSpectrumColor,
  getSpectrumOpacity,
  getSpectrumOpacityParsed,
  getFfmpeg_cfr,
  getFfmpeg_preset,
  getFrame_processing_delay,
  checkIsValidRotationAlias,
  checkIsPercentValue
} from '../config';

describe('config', function() {
  it('getAudioFilePath', function() {
    const result = getAudioFilePath({
      audio: { path: 'test/path' }
    } as Config);
    const expected = path.resolve('test/path');
    expect(result).equal(expected);
  });

  it('getAudioAutoHighlight', function() {
    expect(
      getAudioAutoHighlight({ audio: { path: 'a.wav' } } as Config)
    ).equal(false);
    expect(
      getAudioAutoHighlight({ audio: { path: 'a.wav', autoHighlight: false } } as Config)
    ).equal(false);
    expect(
      getAudioAutoHighlight({ audio: { path: 'a.wav', autoHighlight: true } } as Config)
    ).equal(true);
  });

  it('getAudioAutoHighlightCount', function() {
    expect(
      getAudioAutoHighlightCount({ audio: { path: 'a.wav' } } as Config)
    ).equal(1);
    expect(
      getAudioAutoHighlightCount({ audio: { path: 'a.wav', autoHighlightCount: 3 } } as Config)
    ).equal(3);
    expect(
      getAudioAutoHighlightCount.bind(undefined, { audio: { path: 'a.wav', autoHighlightCount: 0 } } as Config)
    ).to.throw('Invalid audio.autoHighlightCount');
    expect(
      getAudioAutoHighlightCount.bind(undefined, { audio: { path: 'a.wav', autoHighlightCount: 1.5 } } as Config)
    ).to.throw('Invalid audio.autoHighlightCount');
    expect(
      getAudioAutoHighlightCount.bind(undefined, { audio: { path: 'a.wav', autoHighlightCount: NaN } } as Config)
    ).to.throw('Invalid audio.autoHighlightCount');
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

  it('getSubtitleRenderSpec', function() {
    expect(
      getSubtitleRenderSpec({ outVideo: {} } as Config)
    ).equal(undefined);

    expect(
      getSubtitleRenderSpec({
        outVideo: { subtitles: '1\n00:00:00,000 --> 00:00:01,000\nTest' }
      } as Config)
    ).deep.equal({
      source: { kind: 'inline', text: '1\n00:00:00,000 --> 00:00:01,000\nTest' },
      alignment: 'bottom',
    });

    expect(
      getSubtitleRenderSpec({
        outVideo: {
          subtitles: { rawContent: '1\n00:00:00,000 --> 00:00:01,000\nHi', alignment: 'top' }
        }
      } as Config)
    ).deep.equal({
      source: { kind: 'inline', text: '1\n00:00:00,000 --> 00:00:01,000\nHi' },
      alignment: 'top',
    });

    expect(
      getSubtitleRenderSpec({
        outVideo: { subtitles: { path: 'media/sub.srt' } }
      } as Config)
    ).deep.equal({
      source: { kind: 'file', path: path.resolve('media/sub.srt') },
      alignment: 'bottom',
    });

    expect(
      getSubtitleRenderSpec({ outVideo: { subtitles: {} } } as Config)
    ).equal(undefined);

    expect(
      getSubtitleRenderSpec.bind(undefined, {
        outVideo: { subtitles: '' }
      } as unknown as Config)
    ).to.throw('Invalid outVideo.subtitles: expected non-empty string content');

    expect(
      getSubtitleRenderSpec.bind(undefined, {
        outVideo: {
          subtitles: { path: 'a.lrc', rawContent: 'x' }
        }
      } as Config)
    ).to.throw(
      'Invalid outVideo.subtitles: specify only one of "path" or "rawContent", not both.',
    );

    expect(
      getSubtitleRenderSpec.bind(undefined, {
        outVideo: { subtitles: { alignment: 'center' as any } }
      } as Config)
    ).to.throw('Invalid outVideo.subtitles.alignment');
  });

  it('subtitleAlignmentToAss', function() {
    expect(subtitleAlignmentToAss('bottom')).equal(2);
    expect(subtitleAlignmentToAss('middle')).equal(10);
    expect(subtitleAlignmentToAss('top')).equal(6);
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

  it('checkIsPercentValue', function() {
    const result1 = checkIsPercentValue('69%');
    expect(result1).equal(true);

    const result2 = checkIsPercentValue('69');
    expect(result2).equal(false);

    const result3 = checkIsPercentValue('fake value');
    expect(result3).equal(false);
  });

  it('getSpectrumWidthAbsolute', function() {
    const backgroundImageWidth = 1366;
    const result1 = getSpectrumWidthAbsolute({
      outVideo: {}
    } as Config, backgroundImageWidth);
    expect(result1).equal(
      backgroundImageWidth * (parseInt(defaults.spectrumWidth) / 100)
    );

    const result2 = getSpectrumWidthAbsolute({
      outVideo: { spectrum: { width: 600 }}
    } as Config, backgroundImageWidth);
    expect(result2).equal(600);

    const result3 = getSpectrumWidthAbsolute({
      outVideo: { spectrum: { width: '69%' }}
    } as Config, backgroundImageWidth);
    expect(result3).equal(backgroundImageWidth * 0.69);

    const result4 = getSpectrumWidthAbsolute.bind(
      undefined,
      {
        outVideo: { spectrum: { width: '69' }}
      } as Config,
      backgroundImageWidth
    );
    expect(result4).to.throw('Invalid spectrum width value: \'69\'. Use number value or percent value in string, for example: \'30%\'.');

    const result5 = getSpectrumWidthAbsolute.bind(
      undefined,
      {
        outVideo: { spectrum: { width: 1 }}
      } as Config,
      backgroundImageWidth
    );
    expect(result5).to.throw('Spectrum width \'1\' is too small.');

    const result6 = getSpectrumWidthAbsolute.bind(
      undefined,
      {
        outVideo: { spectrum: { width: '1%' }}
      } as Config,
      backgroundImageWidth
    );
    expect(result6).to.throw('Spectrum width \'1%\' is too small.');
  });

  it('getSpectrumHeightAbsolute', function() {
    const backgroundImageHeight = 720;
    const result1 = getSpectrumHeightAbsolute({
      outVideo: {}
    } as Config, backgroundImageHeight);
    expect(result1).equal(160);

    const result2 = getSpectrumHeightAbsolute({
      outVideo: { spectrum: { height: 420 }}
    } as Config, backgroundImageHeight);
    expect(result2).equal(420);

    const result3 = getSpectrumHeightAbsolute({
      outVideo: { spectrum: { height: '69%' }}
    } as Config, backgroundImageHeight);
    expect(result3).equal(backgroundImageHeight * 0.69);

    const result4 = getSpectrumHeightAbsolute.bind(
      undefined,
      {
        outVideo: { spectrum: { height: '69' }}
      } as Config,
      backgroundImageHeight
    );
    expect(result4).to.throw('Invalid spectrum height value: \'69\'. Use number value or percent value in string, for example: \'30%\'.');
  });

  it('getSpectrumXAbsolute', function() {
    const spectrumWidth = 420;
    const backgroundImageWidth = 1366;
    const result1 = getSpectrumXAbsolute(
      {
        outVideo: {},
      } as Config,
      spectrumWidth,
      backgroundImageWidth
    );
    expect(result1).equal(
      0.5 * backgroundImageWidth - spectrumWidth / 2
    );

    const result2 = getSpectrumXAbsolute(
      {
        outVideo: { spectrum: { x: 420 } }
      } as Config,
      spectrumWidth,
      backgroundImageWidth
    );
    expect(result2).equal(420);

    const result3 = getSpectrumXAbsolute(
      {
        outVideo: { spectrum: { x: 'left' } }
      } as Config,
      spectrumWidth,
      backgroundImageWidth
    );
    expect(result3).equal(0);

    const result4 = getSpectrumXAbsolute(
      {
        outVideo: { spectrum: { x: 'center' } }
      } as Config,
      spectrumWidth,
      backgroundImageWidth
    );
    expect(result4).equal(
      0.5 * backgroundImageWidth - spectrumWidth / 2
    );

    const result5 = getSpectrumXAbsolute(
      {
        outVideo: { spectrum: { x: 'right' } }
      } as Config,
      spectrumWidth,
      backgroundImageWidth
    );
    expect(result5).equal(
      1 * backgroundImageWidth - spectrumWidth
    );

    const result6 = getSpectrumXAbsolute.bind(
      undefined,
      {
        outVideo: { spectrum: { x: 'sagewklkg' } }
      } as unknown as Config,
      spectrumWidth,
      backgroundImageWidth
    );
    expect(result6).to.throw('Invalid spectrum x value: sagewklkg. Valid values: left, center, right, top, middle, bottom.');
  });

  it('getSpectrumYAbsolute', function() {
    const spectrumHeight = 125;
    const backgroundImageHeight = 721;
    const result1 = getSpectrumYAbsolute(
      {
        outVideo: {},
      } as Config,
      spectrumHeight,
      backgroundImageHeight
    );
    expect(result1).equal(
      298
    );

    const result2 = getSpectrumYAbsolute(
      {
        outVideo: { spectrum: { y: 69 } }
      } as Config,
      spectrumHeight,
      backgroundImageHeight
    );
    expect(result2).equal(69);

    const result3 = getSpectrumYAbsolute(
      {
        outVideo: { spectrum: { y: 'top' } }
      } as Config,
      spectrumHeight,
      backgroundImageHeight
    );
    expect(result3).equal(0);

    const result4 = getSpectrumYAbsolute(
      {
        outVideo: { spectrum: { y: 'middle' } }
      } as Config,
      spectrumHeight,
      backgroundImageHeight
    );
    expect(result4).equal(
      0.5 * backgroundImageHeight - spectrumHeight / 2
    );

    const result5 = getSpectrumYAbsolute(
      {
        outVideo: { spectrum: { y: 'bottom' } }
      } as Config,
      spectrumHeight,
      backgroundImageHeight
    );
    expect(result5).equal(
      1 * backgroundImageHeight - spectrumHeight
    );

    const result6 = getSpectrumYAbsolute.bind(
      undefined,
      {
        outVideo: { spectrum: { y: 'asokosckm' } }
      } as unknown as Config,
      spectrumHeight,
      backgroundImageHeight
    );
    expect(result6).to.throw('Invalid spectrum y value: asokosckm. Valid values: left, center, right, top, middle, bottom.');
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

  it('getSpectrumOpacity', function() {
    const result1 = getSpectrumOpacity({
      outVideo: {}
    } as Config);
    expect(result1).equal(defaults.spectrumOpacity);

    const result2 = getSpectrumOpacity({
      outVideo: { spectrum: { opacity: '69%' } }
    } as Config);
    expect(result2).equal('69%');
  });

  it('getSpectrumOpacityParsed', function() {
    const result1 = getSpectrumOpacityParsed({
      outVideo: {}
    } as Config);
    expect(result1).equal(parseInt(defaults.spectrumOpacity) / 100);

    const result2 = getSpectrumOpacityParsed({
      outVideo: { spectrum: { opacity: '69%' } }
    } as Config);
    expect(result2).equal(0.69);

    const result3 = getSpectrumOpacityParsed.bind(
      undefined,
      {
        outVideo: { spectrum: { opacity: 'fake value' } }
      } as Config
    );
    expect(result3).to.throw('Invalid spectrum opacity value: \'fake value\'. Use string percent value, for example \'80%\'.');

    const result4 = getSpectrumOpacityParsed.bind(
      undefined,
      {
        outVideo: { spectrum: { opacity: '103%' } }
      } as Config
    );
    expect(result4).to.throw('Invalid spectrum opacity value: \'103%\'. Percent values must be in range from \'0%\' to \'100%\'.');
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

  it('checkIsValidRotationAlias', function() {
    const result1 = checkIsValidRotationAlias('up');
    expect(result1).equal(true);

    const result2 = checkIsValidRotationAlias('down');
    expect(result2).equal(true);

    const result3 = checkIsValidRotationAlias('fake value');
    expect(result3).equal(false);
  });
});
