export interface EncodedBmp {
  shiftPos: number;
  rowBytes: number;
  data: Buffer;
}

const writeBmpHeader = (buffer: Buffer, width: number, height: number, rgbSize: number) => {
  const headerInfoSize = 40;
  const offset = 54;
  const fileSize = rgbSize + offset;

  let pos = 0;
  buffer.write('BM', pos, 2); pos += 2;
  buffer.writeUInt32LE(fileSize, pos); pos += 4;
  buffer.writeUInt32LE(0, pos); pos += 4;
  buffer.writeUInt32LE(offset, pos); pos += 4;

  buffer.writeUInt32LE(headerInfoSize, pos); pos += 4;
  buffer.writeUInt32LE(width, pos); pos += 4;
  buffer.writeInt32LE(-height, pos); pos += 4;
  buffer.writeUInt16LE(1, pos); pos += 2;
  buffer.writeUInt16LE(24, pos); pos += 2;
  buffer.writeUInt32LE(0, pos); pos += 4;
  buffer.writeUInt32LE(rgbSize, pos); pos += 4;
  buffer.writeUInt32LE(0, pos); pos += 4;
  buffer.writeUInt32LE(0, pos); pos += 4;
  buffer.writeUInt32LE(0, pos); pos += 4;
  buffer.writeUInt32LE(0, pos); pos += 4;

  return offset;
};

export const createBpmEncoder = (imgData: { width: number; height: number; }) => {
  const width = imgData.width;
  const height = imgData.height;
  const extraBytes = width % 4;
  const rgbSize = height * (3 * width + extraBytes);
  const offset = 54;

  return (buffer: Buffer): EncodedBmp => {
    const tempBuffer = Buffer.alloc(offset + rgbSize);
    const pos = writeBmpHeader(tempBuffer, width, height, rgbSize);

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

export const createBgrFrameEncoder = (imgData: { width: number; height: number }) => {
  const width = imgData.width;
  const height = imgData.height;
  const extraBytes = width % 4;
  const rowBytes = 3 * width + extraBytes;
  const rgbSize = height * rowBytes;
  const offset = 54;

  const tempBuffer = Buffer.alloc(offset + rgbSize);
  const pos = writeBmpHeader(tempBuffer, width, height, rgbSize);

  return (bgrBuffer: Buffer): EncodedBmp => {
    if (extraBytes === 0) {
      bgrBuffer.copy(tempBuffer, pos, 0, width * height * 3);
    } else {
      for (let y = 0; y < height; y++) {
        const srcOffset = y * width * 3;
        const dstOffset = pos + y * rowBytes;
        bgrBuffer.copy(tempBuffer, dstOffset, srcOffset, srcOffset + width * 3);
      }
    }

    return {
      shiftPos: pos,
      rowBytes,
      data: tempBuffer
    };
  };
};
