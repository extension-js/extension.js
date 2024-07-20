import path from 'path';
import goGitIt from 'go-git-it';
import { blue, green, white, bold, underline } from '@colors/colors/safe';
import downloadAndExtractZip from '../commands/dev/extract-from-zip';

const isUrl = (url: string) => {
  try {
    // eslint-disable-next-line no-new
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
};

async function importUrlSourceFromGithub(
  pathOrRemoteUrl: string,
  text: string,
) {
  await goGitIt(pathOrRemoteUrl, process.cwd(), text);

  return path.resolve(process.cwd(), path.basename(pathOrRemoteUrl));
}

async function importUrlSourceFromZip(pathOrRemoteUrl: string) {
  await downloadAndExtractZip(pathOrRemoteUrl, process.cwd());
  // remove all query params from url
  pathOrRemoteUrl = pathOrRemoteUrl.split('?')[0];

  return path.resolve(process.cwd(), path.basename(pathOrRemoteUrl));
}

export async function getProjectPath(pathOrRemoteUrl: string | undefined) {
  if (!pathOrRemoteUrl) {
    return process.cwd();
  }

  if (isUrl(pathOrRemoteUrl)) {
    const url = new URL(pathOrRemoteUrl);

    if (url.protocol.startsWith('http')) {
      if (url.origin !== 'https://github.com') {
        const urlSource = await importUrlSourceFromZip(pathOrRemoteUrl);

        return urlSource;
      }

      const urlData = url.pathname.split('/');
      const owner = urlData.slice(1, 3)[0];
      const project = urlData.slice(1, 3)[1];
      const projectName = path.basename(url.pathname);
      console.log(
        `🧩 ${bold(`Extension.js`)} ${green(`►►►`)} Fetching data from ${blue(
          underline(`https://github.com/${owner}/${project}`),
        )}`,
      );
      const downloadingText = `🧩 ${bold(`Extension.js`)} ${green(
        `►►►`,
      )} Downloading ${bold(projectName)}...`;
      const urlSource = await importUrlSourceFromGithub(
        pathOrRemoteUrl,
        downloadingText,
      );
      console.log(
        `🧩 ${bold(`Extension.js`)} ${green(
          `►►►`,
        )} Creating a new browser extension in ${white(
          underline(`${process.cwd()}/${projectName}`),
        )}`,
      );

      return urlSource;
    }
  }

  return path.resolve(process.cwd(), pathOrRemoteUrl);
}
