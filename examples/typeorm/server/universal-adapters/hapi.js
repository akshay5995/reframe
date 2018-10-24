const formBody = require("body/form")
const qs = require('querystring');
const Boom = require('boom');
const assert_usage = require('reassert/usage');

const {getHandlers, getResponseObject} = require('./common');

module.exports = UniversalHapiAdapter;
module.exports.buildResponse = buildResponse;
module.exports.addParams = addParams;


function UniversalHapiAdapter(handlers, {useOnPreResponse: false}={}) {

    const {requestHandlers, paramHandlers, onServerCloseHandlers} = getHandlers(handlers);

    const HapiPlugin = {
        name: 'UniversalHapiAdapter',
        multiple: false,
        register: server => {
            if( ! useOnPreResponse ) {
              server.route({
                  method: ['GET', 'POST'],
                  path: '/{param*}',
                  handler: async (request, h) => {
                    const resp = await buildResponse({requestHandlers, request, h});
                    if( resp === null ) {
                      throw Boom.notFound(null, {});
                    }
                    return resp;
                  }
              });
            } else {
              server.ext('onPreResponse', async (request, h) => {
                const resp = await buildResponse({requestHandlers, request, h});
                if( resp === null ) {
                  return h.continue;
                }
                return resp;
              });
            }

            server.ext('onRequest', async (request, h) => {
              await addParams({paramHandlers, request});
              return h.continue;
            });

            server.ext('onPostStop', async () => {
                for(const cb of onServerCloseHandlers) {
                  await cb();
                }
            });
        },
    };

    return HapiPlugin;


}

async function buildResponse({requestHandlers, request, h}) {
    assert_usage(requestHandlers);
    assert_usage(request && request.raw && request.raw.req);
    assert_usage(h && h.continue);

    if( isAlreadyServed(request) ) {
        return h.continue;
    }

    const handlerArgs = getHandlerArgs({request});

    for(const requestHandler of requestHandlers) {
      const responseObject = getResponseObject(await requestHandler(handlerArgs));
      if( resp === null ) {
        continue;
      }

      const {body, redirect, headers} = responseObject;

      const resp = h.response(body);

      let etag;
      headers
      .filter(({name, value}) => {
        if( name.toLowerCase()==='etag' ) {
          etag = value;
          assert_usage(
            etag[0]==='"' && etag.slice(-1)[0]==='"',
            "Malformatted etag",
            etag
          );
          etag = etag.slice(1, -1);
          return false;
        }
        return true;
      });
      .forEach(({name, value}) => resp.header(name, value));

      // We use hapi's etag machinery instead of setting the etag header ourselves
      if( etag ) {
          const response_304 = h.entity({etag});
          if( response_304 ) {
              return response_304;
          }
          response.etag(etag);
      }

      if( redirect ) {
          resp.redirect(redirect);
      }

      return resp;
    }

    return null;
}

function extractEtag(headers) {
}

async function addParams({paramHandlers, request}) {
  assert_usage(paramHandlers);
  assert_usage(request && request.raw && request.raw.req);

  const handlerArgs = getHandlerArgs({request});

  for(const paramHandler of paramHandlers) {
    assert_usage(paramHandler instanceof Function);
    const newParams = await paramHandler(handlerArgs);
    assert_usage(newParams===null || newParams && newParams.constructor===Object);
    Object.assign(request, newParams);
  }
}

function getHandlerArgs({request}) {
  assert_internal(request && request.raw && request.raw.req);
  return (
    {
      ...request,
      req: request.raw.req,
    }
  );
}

function isAlreadyServed(request) {
    if( ! request.response ) {
        return false;
    }

    if( ! request.response.isBoom || (request.response.output||{}).statusCode !== 404 ) {
        return true;
    }

    /*
    if( request.response.headers===undefined && request.response.output===undefined ) {
        return false;
    }
    */

    return false;
}

/*
function getBodyPayload(req, url) {
    if( req.method==='GET' ) {
        return Object.assign({}, qs.parse(url.search.slice(1)));
    }
    let resolve;
    let reject;
    const promise = new Promise((resolve_, reject_) => {resolve = resolve_; reject = reject_;});

    console.log(111);
	let body = '';
	req.on('data', function (data) {
    console.log(222);
		body += data;
		if (body.length > 1e6)
			req.connection.destroy();
	});
	req.on('end', function () {
    console.log(333);
		var post = qs.parse(body);
        resolve(post);
	});

	return promise;
}
*/

/*
function getBodyPayload(req) {
    let resolve;
    let reject;
    const promise = new Promise((resolve_, reject_) => {resolve = resolve_; reject = reject_;});
    console.log(11111);
    formBody(req, {}, (err, body) => {
    console.log(22222);
        if( err ) {
            reject(err);
        } else {
            resolve(body);
        }
    });
    return promise;
}
*/
