import { createSandbox } from 'sinon';
import { Readable, Writable } from 'stream';
import child_process, { ChildProcessWithoutNullStreams } from 'child_process';

export let childProcessStream = {
  stdin: new Writable(),
  stderr: new Readable(),
};

const videoSandbox = createSandbox();
export const spawnStub =
  videoSandbox.stub(child_process, 'spawn').returns(childProcessStream as ChildProcessWithoutNullStreams);
