import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_MAJOR = 24;

export function nodeMajor(version) {
  const match = /^(\d+)\./.exec(version);
  return match ? Number(match[1]) : Number.NaN;
}

export function supportedNodeVersion(version) {
  return nodeMajor(version) === REQUIRED_MAJOR;
}

export function versionMessage(version) {
  return `Daily SQL & DE Practice requires Node ${REQUIRED_MAJOR} LTS. You are running Node ${version}. Install and select Node ${REQUIRED_MAJOR} (for nvm: \`nvm install ${REQUIRED_MAJOR} && nvm use ${REQUIRED_MAJOR}\`), then rerun this command.`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!supportedNodeVersion(process.versions.node)) {
    console.error(versionMessage(process.versions.node));
    process.exitCode = 1;
  }
}
