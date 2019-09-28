const fftUtil = require('fft-js').util;
const ifft = require('fft-js').ifft;

const brutForceFFTSignalLength = PCMDataLength => {
  let exponent = 1;
  while (true) {
    const pow = Math.pow(2, exponent);
    if ((pow * 2) > PCMDataLength) {
      return Math.pow(2, exponent - 1) * 2;
    }
    exponent++;
  }
};

const getFFT = (PCMData, sampleRate) => {
  const signal = [];
  const signalLength = brutForceFFTSignalLength(PCMData.length);
  for (let i = 0; i < signalLength; i += 2) {
    signal.push(
      [
        PCMData[i],
        PCMData[i + 1]
      ]
    );
  }
  const phasors = ifft(signal);
  const frequencies = fftUtil.fftFreq(phasors, sampleRate);
  const magnitudes = fftUtil.fftMag(phasors);
  const both = frequencies.map(function (f, ix) {
    return { frequency: f, magnitude: magnitudes[ix] };
  });
  return both;
}

module.exports = {
  getFFT
};
