export interface EncodedBmp {
  shiftPos: number;
  rowBytes: number;
  data: Buffer;
}

export const createBpmEncoder = (imgData: { width: number; height: number; }) => {
  const width = imgData.width;
  const height = imgData.height;
  const extraBytes = width % 4;
  const rgbSize = height * (3 * width + extraBytes);
  const headerInfoSize = 40;

  /******************header***********************/
  const flag = 'BM';
  const reserved = 0;
  const offset = 54;
  const fileSize = rgbSize + offset;
  const planes = 1;
  const bitPP = 24;
  const compress = 0;
  const hr = 0;
  const vr = 0;
  const colors = 0;
  const importantColors = 0;

  return (buffer: Buffer): EncodedBmp => {
    const tempBuffer = Buffer.alloc(offset + rgbSize);

    let pos = 0;
    tempBuffer.write(flag, pos, 2); pos += 2;
    tempBuffer.writeUInt32LE(fileSize, pos); pos += 4;
    tempBuffer.writeUInt32LE(reserved, pos); pos += 4;
    tempBuffer.writeUInt32LE(offset, pos); pos += 4;

    tempBuffer.writeUInt32LE(headerInfoSize, pos); pos += 4;
    tempBuffer.writeUInt32LE(width, pos); pos += 4;
    tempBuffer.writeInt32LE(-height, pos); pos += 4;
    tempBuffer.writeUInt16LE(planes, pos); pos += 2;
    tempBuffer.writeUInt16LE(bitPP, pos); pos += 2;
    tempBuffer.writeUInt32LE(compress, pos); pos += 4;
    tempBuffer.writeUInt32LE(rgbSize, pos); pos += 4;
    tempBuffer.writeUInt32LE(hr, pos); pos += 4;
    tempBuffer.writeUInt32LE(vr, pos); pos += 4;
    tempBuffer.writeUInt32LE(colors, pos); pos += 4;
    tempBuffer.writeUInt32LE(importantColors, pos); pos += 4;

    let i = 0;
    const rowBytes = 3 * width + extraBytes;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = pos + y * rowBytes + x * 3;
        i++; // a
        tempBuffer[p] = buffer[i++]; // b
        tempBuffer[p + 1] = buffer[i++]; // g
        tempBuffer[p + 2] = buffer[i++]; // r
      }
      if (extraBytes > 0) {
        const fillOffset = pos + y * rowBytes + width * 3;
        tempBuffer.fill(0, fillOffset, fillOffset + extraBytes);
      }
    }

    return {
      shiftPos: pos,
      rowBytes,
      data: tempBuffer
    };
  };
};
