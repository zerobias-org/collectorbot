
import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import { UUID, URL } from '@auditmation/types-core-js';
import { StandardStatus, StandardCategory } from '@auditmation/module-auditmation-auditmation-portal';

const elementTypes: string[] = [];
const elements: string[] = [];
const elementParentMap: Record<string, string> = {};

function isKnownFileType(filename: string): boolean {
  return (filename.toLowerCase().endsWith('.yml') || filename.toLowerCase().endsWith('.json'));
}

async function readAndParseFile(file: string, fullPathFile: string): Promise<any> {
  if (isKnownFileType(file)) {
    const fileData = (await fs.readFile(fullPathFile)).toString();

    // eslint-disable-next-line no-await-in-loop
    let name = file;

    if (name.indexOf('/') !== -1) {
      name = name.substring(name.lastIndexOf('/') + 1);
    }

    name = name.substring(0, name.lastIndexOf('.'));

    let document = null;

    if (file.endsWith('.yml')) {
      // YAML parser
      document = yaml.parse(fileData);
    } else if (file.endsWith('.json')) {
      // Native JSON parser
      document = JSON.parse(fileData);
    }

    return document;
  }

  throw new Error(`File type not supported: ${file}`);
}

function processPackageJson(packageFile: Record<string, any>, code: string): void {
  let check: any = packageFile.name !== undefined && packageFile.name !== null
    && packageFile.name === `@zerobias-org/framework-${code.replace('_', '-').replace('.', '_')}` ? true
    : new Error('package.json missing name or not set to @zerobias-org/framework-<codeWithDashes>');

  check = packageFile.description !== undefined && packageFile.description !== null
    ? true : new Error('package.json missing description or needs replacement from {standardName}');
  if (check === '{standardName}') {
    throw new Error('package.json description needs replacement from {standardName}');
  }

  let codeSplit = code.split('_');
  if (codeSplit.length < 2 || codeSplit.length > 4) {
    throw new Error(`code found in index.yml must match format: {vendor_suite?_product?_version}`);
  }

  codeSplit[codeSplit.length - 1] = codeSplit[codeSplit.length - 1].replace('.', '_')
  if (packageFile.auditmation && typeof packageFile.auditmation === 'object') {
    const auditmation = packageFile.auditmation;
    check = auditmation['import-artifact'] !== undefined && auditmation['import-artifact'] !== null && auditmation['import-artifact'] === 'framework'
      ? true : new Error('package.json auditmation section missing import-artifact or not set to framework');
    check = auditmation.package !== undefined && auditmation.package !== null && auditmation.package === `zerobias.${codeSplit.join('.')}.framework`
      ? true : new Error(`package.json auditmation section missing package or not set to zerobias.${codeSplit.join('.')}.framework`);
    check = auditmation['dataloader-version'] !== undefined && auditmation['dataloader-version'] !== null ? true
      : new Error('package.json auditmation section missing dataloader-version');
  } else {
    throw new Error(`package.json missing auditmation section`);
  }

  codeSplit.splice(codeSplit.length - 1);
  let ownerType = 'vendor';
  if (codeSplit.length === 3) {
    ownerType = 'product';
  } else if (codeSplit.length === 2) {
    ownerType = 'suite';
  }

  // Will be used for future, when we have consistentcy on VSP packages
  // const dependencies = packageFile.dependencies !== undefined && packageFile.dependencies !== null ? packageFile.dependencies : {};
  // if (dependencies[`@auditlogic/${ownerType}-${codeSplit.join('-')}`] === undefined
  //   || dependencies[`@auditlogic/${ownerType}-${codeSplit.join('-')}`] === null) {
  //   throw new Error(`package.json missing dependency for ${ownerType} '@auditlogic/${ownerType}-${codeSplit.join('-')}'`);
  // }
}

async function processIndexYml(indexFile: Record<string, any>): Promise<string> {
  const code = indexFile.code !== undefined && indexFile.code !== null && indexFile.code !== '{code}' ? indexFile.code
    : new Error('code not found in index.yml');
  if (typeof code !== 'string'  || code === '{code}') {
    throw new Error('code in index.yml needs replacement from {code}');
  }

  let check: any;
  check = indexFile.standardType !== undefined && indexFile.standardType !== null && indexFile.standardType === 'framework'
   ? indexFile.standardType : new Error('standardType not found in index.yml or not equal to framework');
  check = indexFile.standardCategory !== undefined && indexFile.standardCategory !== null && StandardCategory.from(indexFile.standardCategory)
    ? indexFile.standardCategory : new Error('standardCategory not found in index.yml');
  check = indexFile.id !== undefined && indexFile.id !== null && indexFile.id !== '{id}' ? new UUID(indexFile.id)
    : new Error('id not found in index.yml');
  check = indexFile.name !== undefined && indexFile.name !== null && indexFile.name !== '{name}' ? indexFile.name
    : new Error('name not found in index.yml');
  if (typeof check !== 'string') {
    throw new Error('name in index.yml needs replacement from {name}');
  }

  check = indexFile.description !== undefined && indexFile.description !== null && indexFile.description !== '{description}'
    ? indexFile.description : new Error('description not found in index.yml');
  if (typeof check !== 'string') {
    throw new Error('description in index.yml needs replacement from {description}');
  }

  check = indexFile.url !== undefined && indexFile.url !== null ? new URL(indexFile.url) : true;
  check = indexFile.status !== undefined && indexFile.status !== null ? StandardStatus.from(indexFile.status)
    : new Error('status not found in index.yml');
  check = indexFile.externalId !== undefined && indexFile.externalId !== null && indexFile.externalId !== '{externalId}'
    ? indexFile.externalId : new Error('externalId not found in index.yml');
  if (typeof check !== 'string') {
    throw new Error('externalId in index.yml needs replacement from {externalId}');
  }

  check = indexFile.aliases !== undefined && indexFile.aliases !== null ? indexFile.aliases : [];
  for (const alias of check) {
    if (typeof alias !== 'string') {
      throw new Error('aliases in index.yml needs to be a string[]');
    }
  }
 
  const eTypes = indexFile.elementTypes !== undefined && indexFile.elementTypes !== null ? indexFile.elementTypes : [];
  if (!Array.isArray(eTypes)) {
    throw new Error('elementTypes in index.yml must be an array');
  }

  eTypes.forEach((elementType) => {
    if (typeof elementType !== 'object') {
      throw new Error('elementTypes in index.yml must be of objects');
    }

    if (!elementType.id) {
      throw new Error('elementType object elementTypes array in index.yml missing id field');
    } else if (!elementType.name) {
      throw new Error('elementType object elementTypes array in index.yml missing name field');
    } else if (!elementType.code) {
      throw new Error('elementType object elementTypes array in index.yml missing code field');
    } else if (!elementType.description) {
      throw new Error('elementType object elementTypes array in index.yml missing description field');
    }

    try {
      check = new UUID(elementType.id);
    } catch (e: any) {
      throw new Error('elementType object elementTypes array in index.yml id must be a uuid');
    }

    elementTypes.push(elementType.code);
  });

  const mappingTypes = indexFile.mappingTypes !== undefined && indexFile.mappingTypes !== null ? indexFile.mappingTypes : [];
  if (!Array.isArray(mappingTypes)) {
    throw new Error('mappingTypes in index.yml must be an array');
  }

  for (const mappingType of mappingTypes)  {
    if (!elementTypes.includes(mappingType)) {
      throw new Error(`mappingType ${mappingType} must be a valid element type.`);
    }
  }

  return code;
}

async function processElements(directory: string, elementCodes: string[]): Promise<void> {
  for (const elementCode of elementCodes) {
    const code = elementCode.replace(/\.yml$|\.md$/i, '');
    const codeRegex = /^[0-9a-z_-]+$/;
    if (!codeRegex.test(code)) {
      throw new Error(`element file name (element code) ${code} must follow syntax lowercase alphanumeric with _ or - only.`);
    }

    const elementYml = await readAndParseFile(`${code}.yml`, path.join(directory, `${code}.yml`));
    if (!elementYml) {
      throw new Error(`Unable to parse ${directory}/${code}.yml`);
    }

    let check: any;
    check = elementYml.id !== undefined && elementYml.id !== null && elementYml.id !== '{id}' ? new UUID(elementYml.id)
      : new Error(`id not found in elements/${code}.yml`);
    check = elementYml.name !== undefined && elementYml.name !== null ? elementYml.name
      : new Error(`name not found in elements/${code}.yml`);
    if (typeof check !== 'string' || check === '{name}') {
      throw new Error(`name in elements/${code}.yml needs replacement from {name}`);
    }

    check = elementYml.description !== undefined && elementYml.description !== null && elementYml.description !== '{description}'
      ? elementYml.description : new Error(`description not found in elements/${code}.yml`);
    if (typeof check !== 'string' || check === '{description}') {
      throw new Error(`description in elements/${code}.yml needs replacement from {description}`);
    }

    check = elementYml.externalId !== undefined && elementYml.externalId !== null && elementYml.externalId !== '{externalId}'
      ? elementYml.externalId : new Error(`externalId not found in elements/${code}.yml`);
      if (typeof check !== 'string' || check === '{externalId}') {
      throw new Error(`externalId in elements/${code}.yml needs replacement from {externalId}`);
    }

    check = elementYml.aliases !== undefined && elementYml.aliases !== null ? elementYml.aliases : [];
    for (const alias of check) {
      if (typeof alias !== 'string') {
        throw new Error(`aliases in elements/${code}.yml needs to be a string[]`);
      }
    }
  
    const elementType = elementYml.elementType !== undefined && elementYml.elementType !== null ? elementYml.elementType
      : new Error(`elementType not found in elements/${code}.yml`);
    if (typeof elementType !== 'string' || elementType === '{elementType}') {
      throw new Error(`elementType in elements/${code}.yml needs replacement from {elementType}`);
    }

    if (!elementTypes.includes(elementType)) {
      throw new Error(`elementType ${elementType} does not exist in index.yml defined element type codes.`);
    }
  
    const parent = elementYml.parent !== undefined && elementYml.parent !== null ? elementYml.parent: undefined;
    if (parent && typeof parent !== 'string') {
      throw new Error(`parent in elements/${code}.yml must be a string`);
    }

    elements.push(code);
    if (parent) {
      elementParentMap[code] = parent;
    }
  }
}

function processElementParents(): void {
  for (const elementCode of Object.keys(elementParentMap)) {
    if (!elements.includes(elementParentMap[elementCode])) {
      throw new Error(`parent ${elementParentMap[elementCode]} in elements/${elementCode}.yml does not match any element defined.`);
    }
  }
}

async function processBaselines(directory: string, baselineCodes: string[]): Promise<void> {
  for (const baselineCode of baselineCodes) {
    const code = baselineCode.replace('.yml', '');
    const codeRegex = /^[0-9a-z_-]+$/;
    if (!codeRegex.test(code)) {
      throw new Error(`baseline file name (baseline code) ${code} must follow syntax lowercase alphanumeric with _ or - only.`);
    }

    const baselineYml = await readAndParseFile(`${code}.yml`, path.join(directory, `${code}.yml`));
    if (!baselineYml) {
      throw new Error(`Unable to parse ${directory}/${code}.yml`);
    }

    let check: any;
    check = baselineYml.id !== undefined && baselineYml.id !== null && baselineYml.id !== '{id}' ? new UUID(baselineYml.id)
      : new Error(`id not found in baslines/${code}.yml`);
    check = baselineYml.name !== undefined && baselineYml.name !== null ? baselineYml.name
      : new Error(`name not found in baslines/${code}.yml`);
    if (typeof check !== 'string' || check === '{name}') {
      throw new Error(`name in baslines/${code}.yml needs replacement from {name}`);
    }

    check = baselineYml.description !== undefined && baselineYml.description !== null && baselineYml.description !== '{description}'
      ? baselineYml.description : new Error(`description not found in baselines/${code}.yml`);
    if (typeof check !== 'string' || check === '{description}') {
      throw new Error(`description in baselines/${code}.yml needs replacement from {description}`);
    }

    const eles = baselineYml.elements !== undefined && baselineYml.elements !== null ? baselineYml.elements
      : new Error(`elements missing from baselines/${code}.yml`);
    if (typeof eles !== 'object' || Object.keys(eles).length === 0) {
      throw new Error(`elements in baselines/${code}.yml must be an object map with atleast 1 element`);
    }

    for (const elementCode of Object.keys(eles)) {
      if (!elements.includes(elementCode)) {
        throw new Error(`element ${elementCode} in elements in baselines/${code}.yml does not match any element loaded.`);
      }

      check = eles[elementCode].mandatory !== undefined && eles[elementCode].mandatory !== null ? eles[elementCode].mandatory
        : false;
      if (typeof check !== 'boolean') {
        throw new Error(`element ${elementCode} mandatory field in elements in baselines/${code}.yml must be a boolean.`);
      }
    }
  }
}

async function processArtifact(directory: string) {
  const checkDir = await fs.lstat(directory)
    .catch(() => undefined);

  if (!checkDir || !checkDir.isDirectory()) {
    throw new Error(`Path given is not found or not a directory: ${directory}`);
  }

  const checkIndexYml = await fs.lstat(path.join(directory, 'index.yml'))
    .catch(() => undefined);

  if (!checkIndexYml || !checkIndexYml.isFile()) {
    throw new Error(`index.yml file not found or not file in directory: ${directory}`);
  }

  const indexYml = await readAndParseFile('index.yml', path.join(directory, 'index.yml'));
  if (!indexYml) {
    throw new Error('Unable to parse index.yml');
  }

  const code = await processIndexYml(indexYml);
  console.log('Validated index.yml');
  const checkPackageJson = await fs.lstat(path.join(directory, 'package.json'))
    .catch(() => undefined);

  if (!checkPackageJson || !checkPackageJson.isFile()) {
    throw new Error(`package.json file not found or is not file in directory: ${directory}`);
  }

  const packageJson = await readAndParseFile('package.json', path.join(directory, 'package.json'));
  if (!packageJson) {
    throw new Error('Unable to parse package.json');
  }

  processPackageJson(packageJson, code);
  console.log('Validated package.json');
  const checkElementsDir = await fs.lstat(path.join(directory, 'elements'))
    .catch(() => undefined);

  if (checkElementsDir) {
    if (!checkElementsDir.isDirectory()) {
      throw new Error('elements must be a directory');
    }

    // Handle elements
    const elementFiles = (await fs.readdir(path.join(directory, 'elements'))).filter((file) => file.endsWith('.yml'));
    await processElements(path.join(directory, 'elements'), elementFiles);
    processElementParents();
    console.log('Validated all elements');
  } else if (elementTypes.length > 0) {
    throw new Error('elementTypes are defined within index.yml but no elements are defined!');
  }

  const checkBaselinesDir = await fs.lstat(path.join(directory, 'baselines'))
    .catch(() => undefined);

  if (checkBaselinesDir) {
    if (!checkBaselinesDir.isDirectory()) {
      throw new Error('baselines must be a directory');
    }

    // Handle baselines
    const baselineFiles = await fs.readdir(path.join(directory, 'baselines'));
    await processBaselines(path.join(directory, 'baselines'), baselineFiles);
    console.log('Validated all baselines');
  }

  const checkNpmrc = await fs.lstat(path.join(directory, '.npmrc'))
    .catch(() => undefined);

  if (!checkNpmrc || !checkNpmrc.isFile()) {
    throw new Error(`.npmrc file not found or is not file in directory: ${directory}`);
  }

  console.log('Validated .npmrc');
}

(async () => {
  try {
    const directory = './';
    await processArtifact(directory);
    console.log('Validation of artifact completed successfully.');
    process.exit(0);
  } catch (error: any) {
    console.error(`Validation failed \n${error.message}\n${JSON.stringify(error.stack)}`);
    process.exit(1);
  }
})();
