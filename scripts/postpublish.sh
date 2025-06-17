#!/bin/bash
cd $(dirname $0)
CURRENT=$(pwd)
echo $CURRENT

if [ "$1" = "--dry-run" ]; then
  DRY_RUN=true
fi;

if [ "$DRY_RUN" = "true" ]; then
  versions=($(npx lerna list --since --ndjson | jq -r '[.version] | join(",")'))
  dirs=($(npx lerna list --since --ndjson | jq -r '[.location] | join(",")'))
else
  versions=($(npx lerna list --since HEAD~1 --ndjson | jq -r  '[.version] | join(",")'))
  dirs=($(npx lerna list --since HEAD~1 --ndjson | jq -r '[.location] | join(",")'))
fi;

for ((i = 0 ; i < ${#versions[@]} ; i++)); do
  package=${dirs[$i]}
  version=${versions[$i]}
  if [ "schema" = $(jq -r '.["import-artifact"]' $package/package.json) ]; then
    echo "Running postpublish on $package, version=$version"
    TS_DIR=$package/ts
    if [ ! -d $TS_DIR ]; then
      echo "Unable to find generated typescript code in: $TS_DIR"
      exit 1
    fi;

    cd $TS_DIR
    
    jq --arg version "$version" '.version = $version' package.json > package-version.json
    status=$?
    if [ $status -ne 0 ]; then
      echo "Unable to replace version for $package and version $version"
      exit 1
    fi;
    mv package-version.json package.json
    jq --arg version "$version" '.version = $version | .packages."".version = $version' package-lock.json > package-lock-version.json
    if [ $status -ne 0 ]; then
      echo "Unable to replace version in lock file $package and version $version"
      exit 1
    fi;
    mv package-lock-version.json package-lock.json
    
    if [ "$DRY_RUN" = "true" ]; then
      echo "Running publish in test mode. npm publish --dry-run"
      npm publish --dry-run
    else
      echo "publishing artifact..."
      npm publish
    fi;
    
    status=$?
    if [ $status -ne 0 ]; then
      echo "failed to publish $package"
      exit 1
    fi;
  else
    echo "Not running post-publish against non schema package $package"
  fi;
done
