/*
 * web-ext configuration.
 *
 * The test suites are development tools, not part of the extension, and the
 * markdown here is repository documentation. Excluding both keeps the lint and
 * any built package clean.
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
    'REVIEWERS.md',
    'LISTING.md',
    'web-ext-config.cjs'
  ]
};
