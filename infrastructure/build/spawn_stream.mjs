// Copyright 2022 The Outline Authors
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

import {spawn} from 'child_process';
import {Transform} from 'node:stream';

import chalk from 'chalk';

/**
 * Create a Stream Transform that splits the child processes' stdout/stderr into lines,
 * and passes each line to the callback function.
 * @param {function(string): void} callback The consumer of each line.
 * @returns {Transform} A Stream Transform that splits the source into lines.
 */
function newChildProcessOutputPipeTransform(callback) {
  // If our transform is called twice with 'abc' and then 'def\n', we need to output
  // only one line 'abcdef\n' instead of two 'abc\n', 'def\n'.
  // This is used to store the unfinished line we received before.
  let pendingLine = '';

  return new Transform({
    // transform will be called whenever the upstream source pushes data to us
    transform(chunk, encoding, done) {
      // encoding will always be 'buffer'
      const lines = chunk.toString().split('\n');
      const lastLine = lines.pop();
      if (lines.length) {
        const firstLine = lines.shift();
        callback(pendingLine + firstLine);
        pendingLine = '';
        lines.forEach(callback);
      }
      pendingLine += lastLine;
      done();
    },

    // flush will be called by destroy()
    flush(done) {
      if (pendingLine) {
        callback(pendingLine);
        pendingLine = '';
      }
      done();
    },
  });
}

/**
 * @description promisifies the child process (for supporting legacy bash actions!)
 */
export const spawnStream = (command, ...parameters) =>
  new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];

    console.debug(
      chalk.gray(
        `Running [${[command, ...parameters.map(e => `'${e}'`)].join(' ')}]...`
      )
    );
    const childProcess = spawn(command, parameters, {
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const stdOutPipe = newChildProcessOutputPipeTransform(line => {
      console.info(line);
      stdout.push(line);
    });
    childProcess.stdout.pipe(stdOutPipe);

    const stdErrPipe = newChildProcessOutputPipeTransform(line => {
      console.error(line);
      stderr.push(line);
    });
    childProcess.stderr.pipe(stdErrPipe);

    childProcess.on('close', code => {
      stdOutPipe.destroy();
      stdErrPipe.destroy();

      if (code === 0) {
        return resolve(stdout.join(''));
      }

      console.error(
        chalk.red(
          `ERROR(spawn_stream): ${chalk.underline(
            [command, ...parameters].join(' ')
          )} failed with exit code ${chalk.bold(code)}.}`
        )
      );

      if (!(stderr.length && stderr.every(line => line))) {
        console.error(
          chalk.bgRedBright(
            'No error output was given... Please fix this so it gives an error output :('
          )
        );
      } else {
        console.error(chalk.bgRedBright('Printing stderr:'));
        stderr.forEach(error => console.error(chalk.rgb(128, 64, 64)(error)));
      }

      return reject(stderr.join(''));
    });
  });
