export const createSpectrumAnalyzer = (bufferSize: number, sampleRate: number) => {
  const real = new Float64Array(bufferSize);
  const imag = new Float64Array(bufferSize);
  const reverseTable = new Uint32Array(bufferSize);

  let limit = 1;
  let bit = bufferSize >> 1;

  while (limit < bufferSize) {
    for (let i = 0; i < limit; i++) {
      reverseTable[i + limit] = reverseTable[i] + bit;
    }

    limit = limit << 1;
    bit = bit >> 1;
  }

  const sinTable = new Float64Array(bufferSize);
  const cosTable = new Float64Array(bufferSize);

  for (let i = 0; i < bufferSize; i++) {
    sinTable[i] = Math.sin(-Math.PI / i);
    cosTable[i] = Math.cos(-Math.PI / i);
  }

  const calculateSpectrum = () => {
    const spectrum: number[] = new Array(bufferSize / 2);
    const bSi = 2 / bufferSize;

    for (var i = 0, N = bufferSize / 2; i < N; i++) {
      const rval = real[i];
      const ival = imag[i];
      const mag = bSi * Math.sqrt(rval * rval + ival * ival);

      spectrum[i] = mag;
    }

    return spectrum;
  }

  return (buffer: number[]) => {
    const k = Math.floor(Math.log(bufferSize) / Math.LN2);

    if (Math.pow(2, k) !== bufferSize) {
      throw new Error('Invalid buffer size, must be a power of 2');
    }
    if (bufferSize !== buffer.length) {
      throw new Error(`Supplied buffer is not the same size as defined FFT. FFT Size: ${bufferSize} Buffer Size: ${buffer.length}`);
    }

    let halfSize = 1;

    for (let i = 0; i < bufferSize; i++) {
      real[i] = buffer[reverseTable[i]];
      imag[i] = 0;
    }

    while (halfSize < bufferSize) {
      const phaseShiftStepReal = cosTable[halfSize];
      const phaseShiftStepImag = sinTable[halfSize];

      let currentPhaseShiftReal = 1;
      let currentPhaseShiftImag = 0;

      for (var fftStep = 0; fftStep < halfSize; fftStep++) {
        let i = fftStep;

        while (i < bufferSize) {
          const off = i + halfSize;
          const tr = (currentPhaseShiftReal * real[off]) - (currentPhaseShiftImag * imag[off]);
          const ti = (currentPhaseShiftReal * imag[off]) + (currentPhaseShiftImag * real[off]);

          real[off] = real[i] - tr;
          imag[off] = imag[i] - ti;
          real[i] += tr;
          imag[i] += ti;

          i += halfSize << 1;
        }

        const tmpReal = currentPhaseShiftReal;
        currentPhaseShiftReal = (tmpReal * phaseShiftStepReal) - (currentPhaseShiftImag * phaseShiftStepImag);
        currentPhaseShiftImag = (tmpReal * phaseShiftStepImag) + (currentPhaseShiftImag * phaseShiftStepReal);
      }

      halfSize = halfSize << 1;
    }

    return calculateSpectrum();
  };
};
