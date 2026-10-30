import { expect, it } from '@rstest/core';

const providerLocation = (method: string) =>
  require.resolve(`../src/shipping/manifests/${method}.cjs`);

it('locates a provider without parsing its JavaScript', () => {
  expect(providerLocation('standard')).toMatch(
    /[\\/]manifests[\\/]standard\.cjs$/,
  );
});
