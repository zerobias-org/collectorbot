const fs = require('fs');
const mustache = require('mustache');
const path = require('path');
const yaml = require('js-yaml');
const util = require('util');

function camelize(str) {
  const camel = str.replace(/\W+(.)/g, function(match, chr) {
    return chr.toUpperCase();
  });
  return camel[0].toLowerCase() + camel.slice(1);
}

function pascalize(str) {
  const camel = str.replace(/\W+(.)/g, function(match, chr) {
    return chr.toUpperCase();
  });
  return camel[0].toUpperCase() + camel.slice(1);
}

function render(templateFile, destFile) {
  const template = fs.readFileSync(path.join(__dirname, '..', 'templates', templateFile), 'utf8');
  const rendered = mustache.render(template, view);
  fs.writeFileSync(path.join(outDir, destFile), rendered);
}

const { name, location } = process.env
const outDir = path.join(process.cwd(), 'generated')

const camel = camelize(name);
const pascal = pascalize(name);

const dryRun = process.argv[2] === '--dry-run' ? true : false;

const view = {
  name,
  camel,
  pascal,
  dryRun,
};

render('run.ts.mustache', 'run.ts');
