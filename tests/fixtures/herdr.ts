// Executed only through a test-created `herdr` shim on an isolated PATH.
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const width = Number(args[args.indexOf('--cols') + 1]);
const height = Number(args[args.indexOf('--rows') + 1]);
console.log(JSON.stringify({ type: 'terminal.frame', width, height, bytes: Buffer.from('fixture').toString('base64'), seq: 1, full: true }));
let input = '';
process.stdin.on('data', chunk => {
  input += chunk.toString();
  if (input.includes('terminal.release')) {
    appendFileSync(process.env.WHISTLE_TEST_RELEASE_FILE!, 'released\n'); process.exit(0);
  }
});
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 1000);
