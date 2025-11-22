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

import { spawn } from 'child_process';
import fs from 'fs';
import { Transform } from 'node:stream';
import path from 'path';

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
 * @param {string} command The command to run
 * @param {...any} parameters Command parameters. If the last parameter is an object with spawn options (cwd, shell, etc.), it will be used as spawn options.
 */
export const spawnStream = (command, ...parameters) =>
  new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];

    let spawnOptions = {
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    };
    let actualParameters = parameters;

    if (
      parameters.length > 0 &&
      typeof parameters[parameters.length - 1] === 'object' &&
      parameters[parameters.length - 1] !== null &&
      !Array.isArray(parameters[parameters.length - 1]) &&
      (parameters[parameters.length - 1].cwd !== undefined ||
        parameters[parameters.length - 1].shell !== undefined ||
        parameters[parameters.length - 1].env !== undefined)
    ) {
      const options = parameters.pop();
      spawnOptions = {
        ...spawnOptions,
        ...options,
      };
    }

    const displayParameters = actualParameters.map(e =>
      typeof e === 'object' && e !== null && !Array.isArray(e)
        ? '[options]'
        : `'${e}'`
    );
    console.debug(
      chalk.gray(
        `Running [${[command, ...displayParameters].join(' ')}]...`
      )
    );

    let childProcess;
    try {
      childProcess = spawn(command, actualParameters, spawnOptions);
    } catch (error) {
      console.error(
        chalk.red(
          `ERROR(spawn_stream): Failed to spawn ${chalk.underline(command)}: ${error.message}`
        )
      );
      if (error.code === 'ENOENT') {
        console.error(
          chalk.bgRedBright(
            `Command not found: "${command}". Make sure it's installed and available in your PATH.`
          )
        );
        if (spawnOptions.cwd) {
          console.error(
            chalk.yellow(
              `Working directory: ${spawnOptions.cwd}`
            )
          );
        }
      }
      return reject(error);
    }

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

    childProcess.on('error', error => {
      stdOutPipe.destroy();
      stdErrPipe.destroy();

      console.error(
        chalk.red(
          `ERROR(spawn_stream): Failed to execute ${chalk.underline(command)}: ${error.message}`
        )
      );

      if (error.code === 'ENOENT') {
        console.error(
          chalk.bgRedBright(
            `Command not found: "${command}". Make sure it's installed and available in your PATH.`
          )
        );
        if (spawnOptions.cwd) {
          console.error(
            chalk.yellow(
              `Working directory: ${spawnOptions.cwd}`
            )
          );
          // Check if the file exists in the working directory
          const fullPath = path.resolve(spawnOptions.cwd, command);
          if (!fs.existsSync(fullPath)) {
            console.error(
              chalk.yellow(
                `File does not exist at: ${fullPath}`
              )
            );
          } else {
            console.error(
              chalk.yellow(
                `File exists at: ${fullPath}`
              )
            );
          }
        }
      } else {
        console.error(chalk.bgRedBright(`Error code: ${error.code || 'unknown'}`));
      }

      return reject(error);
    });

    childProcess.on('close', code => {
      stdOutPipe.destroy();
      stdErrPipe.destroy();

      if (code === 0) {
        return resolve(stdout.join(''));
      }

      const displayParameters = actualParameters.map(e =>
        typeof e === 'object' && e !== null && !Array.isArray(e)
          ? '[options]'
          : String(e)
      );
      console.error(
        chalk.red(
          `ERROR(spawn_stream): ${chalk.underline(
            [command, ...displayParameters].join(' ')
          )} failed with exit code ${chalk.bold(code)}.`
        )
      );

      if (!(stderr.length && stderr.every(line => line))) {
        console.error(
          chalk.bgRedBright(
            'No error output was given... Please fix this so it gives an error output :('
          )
        );
        if (stdout.length > 0) {
          console.error(chalk.yellow('Printing stdout (may contain error info):'));
          stdout.forEach(line => console.error(chalk.rgb(128, 128, 64)(line)));
        }
      } else {
        console.error(chalk.bgRedBright('Printing stderr:'));
        stderr.forEach(error => console.error(chalk.rgb(128, 64, 64)(error)));
      }

      return reject(stderr.join(''));
    });
  });
