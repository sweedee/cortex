import { describe, expect, it } from 'vitest';
import { unpackedAsar } from './config';

describe('unpackedAsar', () => {
  it('maps app.asar to app.asar.unpacked (win and posix), leaves dev paths alone', () => {
    expect(unpackedAsar(String.raw`C:\Apps\Cortex\resources\app.asar`)).toBe(String.raw`C:\Apps\Cortex\resources\app.asar.unpacked`);
    expect(unpackedAsar('/opt/Cortex/resources/app.asar')).toBe('/opt/Cortex/resources/app.asar.unpacked');
    expect(unpackedAsar('/opt/Cortex/resources/app.asar.unpacked')).toBe('/opt/Cortex/resources/app.asar.unpacked');
    expect(unpackedAsar('C:/dev/cortex')).toBe('C:/dev/cortex');
  });
});
