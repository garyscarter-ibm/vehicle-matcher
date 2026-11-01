# Service blueprint design assets

The blueprint uses IBM Carbon's **White** theme, a light theme selected by Russell on 1 November 2026. This document styling applies to the blueprint only; it does not establish the GCSP application's visual reference.

- `carbon.css`: compiled from the official `@carbon/styles` **1.118.0** npm package. Includes theme/layer/layout foundations and button, tag, select, text-input, text-area, data-table and link styles. Source: [Carbon repository](https://github.com/carbon-design-system/carbon/tree/main/packages/styles). Licence: `carbon-LICENSE.txt` (Apache 2.0).
- `carbon.scss`: the small, reproducible entry point selecting those official styles and the White theme.
- `IBMPlexSans-{Light,Regular,SemiBold}.woff2`: local complete WOFF2 fonts from official `@ibm/plex-sans` **1.1.0**. Source: [IBM Plex](https://github.com/IBM/plex). Licence: `plex-LICENSE.txt` (SIL Open Font License).
- Page-specific document layout and printing rules are in `../../service-blueprint.html`. The fifteen-column journey (01–13, with 01a and 04a) uses a semantic table with fixed row and step headings, explicit employee / agent actions, connected responsibility / input rows, and native scrolling. Review fields, tags and buttons use official Carbon component classes. No Carbon React runtime is required.

All assets are local. Reading, adding review comments and exporting notes require no remote assets, API calls or live BMW connection. The links to evidence and the Carbon repository are ordinary navigation links. Keep this directory alongside the HTML when copying the document. Version 4 uses a separate browser-storage key because the flow changed. Saved version 2 and version 3 comments can be exported separately from the review panel without moving them onto changed content.

To rebuild CSS, install the pinned packages and Sass in a temporary folder, then run from the repository root (substitute the temporary folder's absolute path):

```sh
npm install --prefix /tmp/gcsp-blueprint-carbon --no-package-lock --ignore-scripts @carbon/styles@1.118.0 @ibm/plex-sans@1.1.0 sass
/tmp/gcsp-blueprint-carbon/node_modules/.bin/sass --quiet-deps --load-path=/tmp/gcsp-blueprint-carbon/node_modules --style=compressed --no-source-map docs/gcsp/assets/service-blueprint/carbon.scss docs/gcsp/assets/service-blueprint/carbon.css
```

The package installation was isolated from the application's dependencies and scripts were disabled. Generated component CSS is kept intact. Fields have visible labels. Journey text uses a 1.5 line height; Paula's narrative is 16 px, system / input descriptions 14 px and connection metadata 12 px. Print presents the same material one step at a time.
