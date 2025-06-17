import fs from 'fs/promises';
import path from 'path';

(async () => {
  try {
    const directory = './';
    const checkDir = await fs.lstat(directory)
      .catch(() => undefined);
  
    if (!checkDir || !checkDir.isDirectory()) {
      throw new Error(`Path given is not found or not a directory: ${directory}`);
    }

    const checkPackageJson = await fs.lstat(path.join(directory, 'package.json'))
      .catch(() => undefined);
  
    if (!checkPackageJson || !checkPackageJson.isFile()) {
      throw new Error(`package.json file not found or is not file in directory: ${directory}`);
    }
  
    const packageJsonData = (await fs.readFile(path.join(directory, 'package.json'))).toString();
    const packageJson = JSON.parse(packageJsonData);
    if (!packageJson) {
      throw new Error('Unable to parse package.json');
    }

    if (packageJson.dependencies) {
      for (const depKey of Object.keys(packageJson.dependencies)) {
        if (!packageJson.dependencies[depKey].includes('-rc.')) {
          packageJson.dependencies[depKey] = 'latest';
        }
      }
    }

    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(packageJson, null, 2));
    process.exit(0);
  } catch (error: any) {
    console.error(`Dependency correction failed \n${error.message}\n${JSON.stringify(error.stack)}`);
    process.exit(1);
  }
})();
