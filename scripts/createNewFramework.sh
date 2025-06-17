#! /bin/sh

set -x 

if [ $# -lt 4 ]; then
    echo "Usage: $0 <standard_category> <vendor> <suite> <version>"
    exit 1
fi

BASE_DIR=$(dirname $0)
CATEGORY=$1
VENDOR=$2
SUITE=$3
VERSION=$4
EDITED_VERSION=$(echo $VERSION | sed "s/\./_/g")
CODE="$2\_$3\_$4"
FOLDER_PATH="$BASE_DIR/../package/$VENDOR/$SUITE/$EDITED_VERSION"

if [ ! -d "$FOLDER_PATH" ]; then
  echo "Creating folder $FOLDER_PATH."
  mkdir -p $FOLDER_PATH
fi

cp -r $BASE_DIR/../templates/* $FOLDER_PATH
cp  $BASE_DIR/../.npmrc $FOLDER_PATH

sed -i "s/{vendor}/$VENDOR/g" $FOLDER_PATH/package.json
sed -i "s/{suite}/$SUITE/g" $FOLDER_PATH/package.json
sed -i "s/{version}/$EDITED_VERSION/g" $FOLDER_PATH/package.json

UUID=$(uuidgen)
sed -i "s/{id}/$UUID/g" $FOLDER_PATH/index.yml
sed -i "s/{category}/$CATEGORY/g" $FOLDER_PATH/index.yml
sed -i "s/{code}/$CODE/g" $FOLDER_PATH/index.yml
sed -i "s/{version}/$VERSION/g" $FOLDER_PATH/index.yml
