import fs from 'fs/promises';
import path from 'path';

export async function writeEnvironmentJson(capacitorDir, versionName, buildNumber) {
  const outputPath = path.resolve(capacitorDir, 'www', 'environment.json');
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        APP_VERSION: versionName,
        APP_BUILD_NUMBER: String(buildNumber),
      },
      null,
      2
    )
  );
}
