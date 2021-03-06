const assert_internal = require('reassert/internal');
const assert_usage = require('reassert/usage');
const pathModule = require('path');
const findPackageFiles = require('@brillout/find-package-files');

module.exports = getPageConfigFiles;

function getPageConfigFiles({pagesDir}) {
    if( ! pagesDir ) {
        return [];
    }

    const pageConfigFiles = {};

    findPackageFiles('*.config.*', {cwd: pagesDir, no_dir: true})
    .filter(isNotDraft)
    .forEach(pageConfigFile => {
        assert_internal(pageConfigFile);
        const pageName = getPageName(pageConfigFile, pagesDir);
        assert_usage(
            !pageConfigFiles[pageName],
            "The page configs `"+pageConfigFiles[pageName]+"` and `"+pageConfigFile+"` have the same page name `"+pageName+"`.",
            "Rename one of the two page files."
        );
        assert_internal(pageName);
        pageConfigFiles[pageName] = pageConfigFile;
    });

    return pageConfigFiles;
}

function isNotDraft(filePath) {
    // We filter out file names that contain a special character in their extension
    // In order to filter out draft files
    // E.g. VIM saves drafts with a `~` ending such as `/path/to/file.js~`
    const fileExtension = filePath.split('.').slice(-1)[0];
    return /^[a-zA-Z0-9]*$/.test(fileExtension);
}

function getPageName(pageConfigFile, pagesDir) {
    const endPath = pathModule.relative(pagesDir, pageConfigFile);
    assert_internal(!endPath.startsWith(pathModule.sep), endPath, pageConfigFile);
    assert_internal(!endPath.startsWith('.'), endPath, pageConfigFile);
    const pageName = endPath.split(pathModule.sep).slice(-1)[0].split('.')[0];
    assert_internal(pageName, endPath, pageConfigFile);
    return pageName;
}
