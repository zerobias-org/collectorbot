#!/bin/bash
cd $(dirname $0)
CURRENT=$(pwd)
echo $CURRENT

CONTENT_PACKAGE="@auditmation/platform-content"

# contains all package locations that are being tested/published as provided via arguments
# As of right now this is reduced to `schema` artifacts only
declare -a changed_packages

export NODE_MODULES_DIR=$CURRENT/..
if [ ! -d "$NODE_MODULES_DIR/node_modules" ]; then
  echo "Unable to locate node_modules at $NODE_MODULES_DIR"
  exit 1
fi

PGDATABASE=nfa_catalog_template
dropdb --if-exists $PGDATABASE;

echo "Creating DB $PGDATABASE"
echo ""
createdb $PGDATABASE
status=$?
if [ $status -ne 0 ]; then
  echo "failed creating DB $PGDATABASE"
  exit 1
fi;

psql -d $SU_DB -c 'CREATE ROLE "00000000-0000-0000-0000-000000000000"' || echo "NilUUID role already exists"

TMPDIR=$(mktemp -d)
cd $TMPDIR
npm pack $CONTENT_PACKAGE@latest --loglevel=error --silent
if ls auditmation-platform-content* 1> /dev/null 2>&1; then
  echo -e "npm pack succedded on latest content"
else
  echo -e "failed npm pack $CONTENT_PACKAGE@latest"
  exit 1
fi

tar xf auditmation-platform-content*.tgz

echo "### Applying schema ${CONTENT_PACKAGE} to database ${PGDATABASE}"
PGOPTIONS='--client-min-messages=warning'
echo "### Dropping DB if exists: $PGDATABASE"
${NODE_MODULES_DIR}/node_modules/@auditmation/devops-tools/scripts/db/drop.sh

echo "### (Re-)Creating DB $PGDATABASE"
${NODE_MODULES_DIR}/node_modules/@auditmation/devops-tools/scripts/db/create.sh

echo "### Loading ${CONTENT_PACKAGE}"
psql < package/dist/content-full.sql > /dev/null
psql < package/dist/content-data.sql > /dev/null
