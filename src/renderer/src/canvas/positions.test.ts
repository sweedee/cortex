import { describe, expect, it } from 'vitest';
import { bubbleTransform, linkPath, threadPath } from './positions';

describe('canvas geometry', () => {
  it('centres a bubble on its layout point', () => {
    expect(bubbleTransform(100, 50, 30)).toBe('translate(70px, 20px)');
  });

  it('bends a link perpendicular to the line, at most 40px', () => {
    // horizontal, length 100: bend 12 to the +y side
    expect(linkPath({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe('M0,0 Q50,12 100,0');
    // long line: bend capped
    expect(linkPath({ x: 0, y: 0 }, { x: 1000, y: 0 })).toBe('M0,0 Q500,40 1000,0');
  });

  it('draws nothing while a position is unknown', () => {
    expect(linkPath(undefined, { x: 1, y: 1 })).toBe('');
    expect(linkPath({ x: null, y: 2 }, { x: 1, y: 1 })).toBe('');
    // same point: no division by zero
    expect(linkPath({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe('M5,5 Q5,5 5,5');
  });

  it('threads curve from the chat box up to the bubble', () => {
    expect(threadPath(10, 500, 200, 100)).toBe('M10,500 C10,380 200,240 200,100');
  });
});
