import { expect } from 'chai';
import { lrcToSrt, isLikelyLrc, normalizeInlineSubtitlesToSrt } from '../subtitleConvert';

describe('subtitleConvert', function () {
  it('isLikelyLrc', function () {
    expect(isLikelyLrc('[00:01.00]Hello')).equal(true);
    expect(isLikelyLrc('1\n00:00:01,000 --> 00:00:02,000\nSRT')).equal(false);
  });

  it('lrcToSrt converts basic LRC to SRT', function () {
    const lrc = '[00:01.00]Line one\n[00:03.50]Line two';
    const srt = lrcToSrt(lrc);
    expect(srt).to.include('00:00:01,000 --> 00:00:03,500');
    expect(srt).to.include('Line one');
    expect(srt).to.include('00:00:03,500 -->');
    expect(srt).to.include('Line two');
  });

  it('normalizeInlineSubtitlesToSrt leaves SRT unchanged', function () {
    const s = '1\n00:00:00,000 --> 00:00:01,000\nX';
    expect(normalizeInlineSubtitlesToSrt(s)).equal(s);
  });
});
