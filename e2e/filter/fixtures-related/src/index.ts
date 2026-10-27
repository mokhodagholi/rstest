import { greet } from './shared';

export const sayHi = () => greet('index');

export const resolveMessage = () => require.resolve('./resolved.json');
