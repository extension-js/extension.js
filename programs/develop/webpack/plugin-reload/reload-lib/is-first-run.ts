import path from 'path';
import fs from 'fs';

export function isFirstRun(browser: string) {
  return !fs.existsSync(path.resolve(__dirname, `run-${browser}-profile`));
}
