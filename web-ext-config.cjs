/*
 * web-ext configuration.
 *
 * The test suites are development tools, not part of the extension. Excluding
 * them keeps the lint and any built package clean.
 */
module.exports = {
  ignoreFiles: [
    'test',
    '.git',
    '.gitignore',
    '.claude',
    'web-ext-artifacts',
    // Listing artwork: uploaded to AMO by hand, not part of the add-on.
    'Images',
    'README.md',
    'web-ext-config.cjs'
  ]
};
