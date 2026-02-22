# Outline Infrastructure

This document provides a guide for AI agents working with the Outline infrastructure.

## Directory Structure

The `/infrastructure` directory contains the build system, deployment scripts, and other application-independent code for the Outline project.

*   `/build`: Contains the core scripts for the `npm run action` command.
*   `*.ts`: Various TypeScript files providing utility functions for the build system and applications, similar to third-party dependencies.

## The `npm run action` Build System

The `npm run action` command is the heart of the Outline build system. It is implemented as a set of Node.js scripts in the `/infrastructure/build` directory. The main entry point is `run_action.mjs`, which parses the command-line arguments and executes the corresponding action script.

### Creating a New Action

To create a new action, you need to create a new `.mjs` file in the appropriate directory (e.g., `server_manager/www/my_action.mjs`). This file should export a default function that will be executed when the action is run.

The function will be passed an `options` object containing the command-line arguments. You can use the utility functions in `/infrastructure` to perform common tasks like spawning processes, downloading files, and creating reload servers.

### Example Action

```javascript
// server_manager/www/my_action.mjs
import { spawnStream } from '../../infrastructure/build/spawn_stream.mjs';

export default async function(options) {
  await spawnStream('echo', ['Hello, World!']);
}
```

This action can be run with the command `npm run action server_manager/www/my_action`.

## Testing the Infrastructure

The infrastructure code can be tested by running the following command:

`npm run action infrastructure/test`
