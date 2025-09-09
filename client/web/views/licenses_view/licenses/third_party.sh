#!/bin/bash
#
# Copyright 2018 The Outline Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Mimics the output of "yarn licenses generate-disclaimer"
# for the packages in /third_party.

set -eu

readonly THIRD_PARTY_DIR=$(git rev-parse --show-toplevel)/third_party

for i in $(find $THIRD_PARTY_DIR -name METADATA); do
  PACKAGE_NAME=$(basename $(dirname $i))
  HOMEPAGE=$(grep -C 2 HOMEPAGE $i | grep value | sed s/value:// | tr -d ' "')

  echo "The following software may be included in this product: $PACKAGE_NAME"
  echo "A copy of the source code may be downloaded from: $HOMEPAGE"
  echo "This software contains the following license and notice below:"
  echo
  cat $(dirname $i)/LICEN?E*
  echo
  echo
done
