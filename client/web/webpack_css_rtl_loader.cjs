// Copyright 2020 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const postcss = require('postcss');
const rtl = require('postcss-rtl');

const CSS_PROCESSOR = postcss([rtl()]);

function generateRtlCss(css) {
  return (
    CSS_PROCESSOR.process(css)
      .css // Replace the generated selectors with Shadow DOM selectors for Polymer compatibility.
      .replace(/\[dir=rtl\]/g, ':host(:dir(rtl))')
      .replace(/\[dir=ltr\]/g, ':host(:dir(ltr))')
      // rtlcss generates [dir] selectors for rules unaffected by directionality; ignore them.
      .replace(/\[dir\]/g, '')
  );
}

// This is a Webpack loader that searches for <style> blocks and edits the CSS to support RTL
// in a Polymer element.
//
// NOTE: This RTL transformation break any sourcemaps that may exist on the file.
module.exports = function loader(content) {
  const callback = this.async();
  const styleRe = RegExp(/(<style[^>]*>)(\s*[^<\s](.*\n)*\s*)(<\/style>)/gm);
  const newContent = content.replace(styleRe, (match, g1, g2, g3, g4) => `${g1}${generateRtlCss(g2)}${g4}`);
  callback(null, newContent);
  return;
};
