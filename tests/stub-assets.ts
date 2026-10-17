// What the stage's code imports through Vite, stubbed so it loads in Node: a stylesheet is an empty module, and a
// picture or a sound file (.png, .ogg, .opus) is its own file's URL, as Vite makes it one. Import this first, then the
// stage's code with await import(...): the stub applies only to what loads after it (contract-test, claw-sounds-test).
import { register } from 'node:module';

const hooks = `export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  if (/\\.(png|ogg|opus)$/.test(url)) return { format: 'module', source: 'export default ' + JSON.stringify(url) + ';', shortCircuit: true };
  return next(url, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
