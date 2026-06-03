// Copyright 2026 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import url from 'node:url';

import minimist from 'minimist';

import {getRootDir} from './infrastructure/build/get_root_dir.mjs';

const ESLINT_BIN = path.resolve(getRootDir(), 'node_modules', '.bin', 'eslint');

function parseFileList(value) {
  return value.trim().split(/\s+/).filter(Boolean);
}

function normalizePath(filePath) {
  return path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath)
    : filePath;
}

function getChangedLineSet(baseCommit, headCommit, file) {
  const result = spawnSync(
    'git',
    ['diff', '--unified=0', '--no-color', baseCommit, headCommit, '--', file],
    {encoding: 'utf8', cwd: getRootDir()}
  );
  if (result.status !== 0) {
    throw new Error(`git diff failed for ${file}: ${result.stderr}`);
  }

  const lines = new Set();
  const hunkRegExp = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  for (const line of result.stdout.split('\n')) {
    const match = line.match(hunkRegExp);
    if (!match) {
      continue;
    }
    const start = Number.parseInt(match[1], 10);
    const count = Number.parseInt(match[2] || '1', 10);
    for (let i = 0; i < count; i++) {
      lines.add(start + i);
    }
  }
  return lines;
}

function getLine(message, key) {
  const line = message[key];
  return Number.isInteger(line) ? line : null;
}

/**
 * @description Runs the same diff-based lint check as the GitHub Lint workflow.
 * Detects errors on changed lines between the current branch and a base ref.
 *
 * @param {...string} parameters
 */
export async function main(...parameters) {
  const {
    base = 'origin/master',
    'lint-results': lintResultsPath = 'lint-results.json',
  } = minimist(parameters);

  const headCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    cwd: getRootDir(),
  }).stdout.trim();
  const baseCommit = spawnSync('git', ['merge-base', base, 'HEAD'], {
    encoding: 'utf8',
    cwd: getRootDir(),
  }).stdout.trim();

  if (!baseCommit) {
    throw new Error(`Could not find merge-base with ${base}`);
  }

  const changedFiles = spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', baseCommit, headCommit],
    {encoding: 'utf8', cwd: getRootDir()}
  ).stdout;

  const files = parseFileList(changedFiles).filter(
    f => /\.([cm]js|ts|js)$/.test(f)
  );

  if (!files.length) {
    console.log('No changed JS/TS files to lint.');
    return;
  }

  console.log(`Linting ${files.length} changed file(s)...`);

  const eslintResult = spawnSync(
    process.execPath,
    [ESLINT_BIN, '-f', 'json', '-o', lintResultsPath, ...files],
    {encoding: 'utf8', cwd: getRootDir()}
  );

  if (!existsSync(lintResultsPath)) {
    throw new Error(`Missing lint results file: ${lintResultsPath}`);
  }

  const changedLinesByFile = new Map(
    files.map(file => [file, getChangedLineSet(baseCommit, headCommit, file)])
  );
  const lintResults = JSON.parse(readFileSync(lintResultsPath, 'utf8'));
  const blockingIssues = [];

  for (const fileResult of lintResults) {
    const file = normalizePath(fileResult.filePath);
    const changedLines = changedLinesByFile.get(file);
    if (!changedLines) {
      continue;
    }

    for (const message of fileResult.messages || []) {
      if (!(message.severity === 2 || message.fatal)) {
        continue;
      }

      const line = getLine(message, 'line');
      const endLine = getLine(message, 'endLine') || line;
      if (!line) {
        blockingIssues.push({file, line: 1, message});
        continue;
      }

      let intersectsChangedLines = false;
      for (let current = line; current <= endLine; current++) {
        if (changedLines.has(current)) {
          intersectsChangedLines = true;
          break;
        }
      }
      if (intersectsChangedLines) {
        blockingIssues.push({file, line, message});
      }
    }
  }

  if (!blockingIssues.length) {
    console.log('No lint errors found on changed lines.');
    return;
  }

  for (const issue of blockingIssues) {
    const rule = issue.message.ruleId || 'lint';
    const text = issue.message.message.replace(/\r?\n/g, ' ');
    console.log(
      `::error file=${issue.file},line=${issue.line},title=${rule}::${text}`
    );
  }

  console.error(
    `Found ${blockingIssues.length} lint error(s) on changed lines.`
  );
  process.exit(1);
}

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  await main(...process.argv.slice(2));
}
