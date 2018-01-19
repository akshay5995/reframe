import buildScript from './build-script.mjs';
import buildHtml from './build-html.mjs';
import expose from './expose.js';
import getPages from './get-pages.mjs';

process.on('unhandledRejection', err => {throw err});

export default build;

async function build() {
    const browserDistPath = getBrowserDistPath();

    const pages = getPages();

    await buildScript({browserDistPath, pages});
    await buildHtml({browserDistPath, pages});

    return {
        browserDistPath,
        pages,
    };
}

function getBrowserDistPath() {
    const {__dirname} = expose;
    const browserDistPath = __dirname+'/dist';
    return browserDistPath;
}
