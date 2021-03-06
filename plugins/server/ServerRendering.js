const assert_internal = require('reassert/internal');
const crypto = require('crypto');
const getPageHtml = require('@brillout/repage/getPageHtml');
const reconfig = require('@brillout/reconfig');

module.exports = ServerRendering;

// We set a low priority for the universal adapters
ServerRendering.executionPriority = -1000;

async function ServerRendering(request) {
    const html = await getHtml(request);

    if( html === null ) {
        return null;
    }

    const hash = computeHash(html);

    const headers = [];
    headers.push({name: 'Content-Type', value: 'text/html'});
    headers.push({name: 'ETag', value: '"'+hash+'"'});

    return {
        body: html,
        headers,
    }
}

async function getHtml(request) {
    const uri = request.url;
    assert_internal(uri && uri.constructor===String, uri);

    const config = reconfig.getConfig({configFileName: 'reframe.config.js'});

    const {pageConfigs} = config.getBuildInfo();
    const {renderToHtml, router} = config;

    const context = {request};

    const html = await getPageHtml({pageConfigs, uri, renderToHtml, router, context});
    assert_internal(html===null || html.constructor===String, html);

    return html;
}

function computeHash(str) {
    return (
        crypto
        .createHash('md5')
        .update(str, 'utf8')
        .digest('base64')
        .replace(/=+$/, '')
    );
}
