#!/bin/bash
### This scripts is invoked by the nx:prepublish target on each of the publishable schemas
### It creates a fresh database from the template created by `prepublish-init`
### The schema is loaded using dataloader and typescript interfaces are generated under a `ts` directory inside of the schema's location
set -e
set -x

package_path=$(pwd)

cd $(dirname $0)
CURRENT=$(pwd)
echo $CURRENT

if [ ! -f "$package_path/package.json" ]; then
  echo "Unable to locate package.json $package_path"
  exit 1
fi

packagejson=$package_path/package.json
PGOPTIONS='--client-min-messages=warning'

# PGDATABASE=nfa_catalog_template
# echo "Using DB nfa_catalog_template to build schema"

PGDATABASE=$(jq -r '.["name"]' $packagejson)
echo "Creating DB $PGDATABASE from template"
dropdb --if-exists $PGDATABASE
createdb $PGDATABASE -T nfa_catalog_template


# load schema and generate code
# `postpublish.sh` will handle publication of ts artifacts.
echo "loading schemas at $package_path"
dataloader -d $package_path --skip-pgboss
status=$?
if [ $status -ne 0 ]; then
  echo "failed loading artifact $package_path"
  dropdb $PGDATABASE
  exit 1
fi;

echo "Successfully loaded artifact $package_path"
dropdb $PGDATABASE
