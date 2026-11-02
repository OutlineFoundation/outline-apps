# How to Contribute

We'd love to accept your patches and contributions to this project. There are
just a few guidelines you need to follow.

## Code reviews

All submissions, including submissions by project members, require review. We
use GitHub pull requests for this purpose. Consult
[GitHub Help](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests)
for more information on using pull requests.

## Testing your changes

Changes should come with tests. When you fix a bug or add a feature, add or
update unit tests that cover it, and make sure the existing tests still pass
(for example, `npm run action client/web/test`).

Some code can't easily be unit tested, such as the iOS VPN extension, which only
runs on a real device. You must still be able to reasonably test any change you
submit: if your change needs to be tested on a real iOS device, test it on an
iOS device yourself and describe how you tested it in your pull request
description.

Please don't send changes that ask the maintainers to "build and test this on
iOS" to verify them. This puts too much burden on the maintainers, and we cannot
accept changes of this kind.

## AI-generated contributions

AI-generated contributions are welcome, subject to the guidelines in the
[AI contributions](AGENTS.md#ai-contributions) section of `AGENTS.md`.

## Setup: VSCode

You'll have to clean up your extensions to get formatting to work properly.
First, go to the `Extensions` tab and remove any extensions that might be
formatting your code, like `esbenp.prettier-vscode`. Then, if VSCode doesn't
automatically prompt you, install the recommended extensions by searching for
`@recommended`.
