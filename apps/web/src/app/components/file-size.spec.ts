import { fileSize, sha256Hex } from './file-size';

describe('fileSize', () => {
  it('formats bytes in decimal units', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(3_000_000)).toBe('3.0 MB');
    expect(fileSize(100_000_000)).toBe('100.0 MB');
    expect(fileSize(2_500_000_000)).toBe('2.5 GB');
  });
});

describe('sha256Hex', () => {
  it('hashes file contents', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
