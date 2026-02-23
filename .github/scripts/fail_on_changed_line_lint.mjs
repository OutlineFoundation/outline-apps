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

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

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
    {encoding: 'utf8'}
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

function main() {
  const baseCommit = getRequiredEnv('BASE_COMMIT');
  const headCommit = getRequiredEnv('HEAD_COMMIT');
  const lintResultsPath = process.env.LINT_RESULTS_PATH || 'lint-results.json';
  const files = [
    ...parseFileList(process.env.MODIFIED_FILES || ''),
    ...parseFileList(process.env.ADDED_FILES || ''),
  ];

  if (!files.length) {
    return;
  }
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
        // File-level parse/config errors.
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

main();
