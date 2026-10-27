import { describe, expect, it } from '@rstest/core';
import { resolveMessage, sayHi } from './src/index';

const loadMessage = (name: string) =>
  require(`./src/messages/${name}.json`).message;

describe('index', () => {
  it('should greet index', () => {
    expect(sayHi()).toBe('Hello, index!');
    expect(loadMessage('required')).toBe('required');
    expect(resolveMessage()).toMatch(/[/\\]resolved\.json$/);
  });
});
