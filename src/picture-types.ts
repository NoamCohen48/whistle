// The picture types Whistle shows and stores, recognised by their bytes, never by a file
// name or a client's Content-Type alone.
export const pictureTypes = [
  { type: 'image/png', ext: 'png', magic: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', ext: 'jpg', magic: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/webp', ext: 'webp', magic: (b: Buffer) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { type: 'image/gif', ext: 'gif', magic: (b: Buffer) => /^GIF8[79]a$/.test(b.toString('latin1', 0, 6)) },
];

// The picture type of these bytes, or undefined.
export const sniffPicture = (bytes: Buffer) => pictureTypes.find(item => item.magic(bytes));
