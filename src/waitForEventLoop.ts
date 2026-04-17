export const waitForEventLoop = () =>
  new Promise<void>(resolve => setImmediate(resolve));
