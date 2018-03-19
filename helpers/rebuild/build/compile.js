const Promise = require('bluebird'); Promise.longStackTraces();
const assert = require('reassert/hard');
const assert_usage = assert;
const assert_internal = assert;
const log = require('reassert/log');
const webpack = require('webpack');
const path_module = require('path');
const fs = require('fs');
const HtmlCrust = require('@brillout/html-crust');
const mkdirp = require('mkdirp');
const deep_copy = require('./utils/deep_copy');
const log_title = require('./utils/log_title');
const {Config, StandardConfig} = require('@rebuild/config');
//const webpack_mild_compile = require('webpack-mild-compile');
//const readline = require('readline');
//const {Logger} = require('./utils/Logger');

/*
const DEBUG_WATCH = true;
/*/
const DEBUG_WATCH = false;
//*/

module.exports = compile;

function compile(
    arg,
    {
     // logger = Logger(),
        doNotGenerateIndexHtml,
        onBuild,
        compiler_handler,
        compiler_handler__secondary,
        webpack_config_modifier,
        context,
        onCompilationStateChange = ()=>{},
        ...StandardConfig__args
    }
) {
    const webpack_config = get_webpack_config(arg, {webpack_config_modifier, context, ...StandardConfig__args});
    assert_internal(webpack_config.constructor===Array);

    const {stop_build, wait_build, first_setup_promise} = (
        run_all({
            webpack_config,
            compiler_handler,
            compiler_handler__secondary,
            on_compilation_start: ({is_first_start, previous_was_success}) => {
                if( ! is_first_start ) {
                    onCompilationStateChange({
                        is_compiling: true,
                    });
                }
            },
            on_compilation_end: async ({compilation_info, is_first_result, is_first_success, is_success, previous_was_success}) => {
                if( ! doNotGenerateIndexHtml ) {
                    await build_index_html({compilation_info});
                }
                assert_usage(compilation_info.length===1);
                assert_internal([true, false].includes(is_success));
                onCompilationStateChange({
                    is_compiling: false,
                    is_failure: !is_success,
                    ...compilation_info[0],
                });
                if( onBuild && is_success ) {
                    onBuild({compilationInfo: compilation_info, isFirstBuild: is_first_success});
                }
            },
        })
    );

    return {
        stop_build,
        wait_build,
        first_build_promise: (async () => {
            const {compilation_info} = await first_setup_promise;

            if( ! doNotGenerateIndexHtml ) {
                await build_index_html({compilation_info});
            }

            return {compilationInfo: compilation_info, isFirstBuild: true};
        })(),
    };
}

function get_webpack_config(
    arg,
    {
        context=path_module.dirname(module.parent.parent.filename),
        webpack_config_modifier,
        ...StandardConfig__args
    }
) {
    assert_usage(arg);
    assert_usage([String, Array, Object].includes(arg.constructor), arg);

    let webpack_configs = (() => {
        if( arg.constructor === Object ) {
            return [arg];
        }
        if( arg.constructor === Array && arg.every(conf => conf && conf.constructor===Object) ) {
            return arg;
        }
        const entry = arg;
        assert_usage(entry.constructor===String || entry.constructor===Array && entry.every(entry_ => entry_.constructor===String), arg)
        const config = new Config();
        config.add([
            StandardConfig({
                entry,
                context,
                ...StandardConfig__args,
            }),
        ]);
        return [config.assemble()];
    })();
    assert_internal(webpack_configs.constructor===Array);

    if( webpack_config_modifier ) {
        webpack_configs = webpack_configs.map(webpack_config_modifier);
    }

    return webpack_configs;
}

function run_all({
    webpack_config,
    compiler_handler,
    compiler_handler__secondary,
    on_compilation_start,
    on_compilation_end,
}) {
    const compiler__is_running = webpack_config.map(() => false);
    const compiler__info = webpack_config.map(() => null);

    let resolve_promise;
    const first_compilation_promise = new Promise(resolve => resolve_promise = resolve);

    let is_first_start = true;
    let is_first_result = true;
    let no_first_success = true;
    let previous_was_success = null;

    let stop_build;
    let wait_build;
    let server_start_promise;
    webpack_config.forEach((webpack_conf, i) => {
        const compiler_tools = setup_compiler_handler({
            webpack_config: webpack_conf,
            compiler_handler: (
                i===0 ? (
                    compiler_handler
                ) : (
                    compiler_handler__secondary || compiler_handler
                )
            ),
            on_compiler_start: () => {
                const a_compiler_is_running = compiler__is_running.includes(true);
                compiler__is_running[i] = true;
                if( a_compiler_is_running ) {
                    return;
                }
                on_compilation_start({
                    previous_was_success,
                    is_first_start,
                });
                is_first_start = false;
            },
            on_compiler_end: compiler_info => {
                assert_internal(compiler_info.webpack_stats);
                assert_internal(compiler_info.is_success.constructor===Boolean);
                assert_internal(compiler_info.output);

                compiler__is_running[i] = false;
                compiler__info[i] = compiler_info;

                if( compiler__is_running.includes(true) ) {
                    return;
                }
                assert_internal(!compiler__info.includes(null));

                const is_success = compiler__info.every(({is_success}) => is_success===true);

                const is_first_success = is_success && no_first_success;
                if( is_success ) {
                    no_first_success = false;
                }

                const compilation_info = get_compilation_info();

                const compilation_args = {
                    compilation_info,
                    is_success,
                    previous_was_success,
                    is_first_result,
                    is_first_success,
                };

                previous_was_success = is_success;
                is_first_result = false;

                if( is_first_success ) {
                    resolve_promise(compilation_args);
                }
                on_compilation_end(compilation_args);
            },
        });
        assert_usage(webpack_config.length===1);
        wait_build = compiler_tools.wait_build;
        stop_build = compiler_tools.stop_build;
        server_start_promise = compiler_tools.server_start_promise;
    });

    return {
        wait_build,
        stop_build,
        first_setup_promise: (async () => {
            await server_start_promise;
            return await first_compilation_promise;
        })(),
    };

    function get_compilation_info() {
        return (
            webpack_config
            .map((webpack_conf, i) => {
                assert_internal(compiler__info[i]);
                assert_internal(compiler__info[i].output);
                assert_internal(compiler__info[i].webpack_stats);
                assert_internal(compiler__info[i].is_success.constructor===Boolean);
                return {
                    webpack_config: webpack_conf,
                    ...compiler__info[i],
                };
            })
        );
    }
}

function setup_compiler_handler({
    webpack_config,
    compiler_handler,
    on_compiler_start,
    on_compiler_end,
}) {
    assert_internal(webpack_config.constructor===Object, webpack_config);
    assert_internal(webpack_config.entry, webpack_config);
    assert_internal(compiler_handler);

 // webpack_config = debug_config(webpack_config);

    const {webpack_compiler, first_compilation, first_successful_compilation, onCompileStart, onCompileEnd} = (
        get_webpack_compiler(deep_copy(webpack_config))
    );
    assert_internal(webpack_compiler);

    let compilation_promise__resolve;
    let compilation_promise = new Promise(resolve => compilation_promise__resolve=resolve);
    const wait_build = async () => {
        const compilation_promise__awaited_for = compilation_promise;
        await compilation_promise__awaited_for;
        if( compilation_promise !== compilation_promise__awaited_for ) {
            await wait_build();
        }
        assert_internal(compiler_info);
        return compiler_info;
    };
    let compiler_info;
    onCompileStart.addListener(() => {
        compiler_info = null;
        compilation_promise = new Promise(resolve => compilation_promise__resolve=resolve);
        on_compiler_start();
    });
    onCompileEnd.addListener(async ({webpack_stats, is_success}) => {
        compiler_info = await get_compiler_info({webpack_stats, is_success});
        on_compiler_end(compiler_info);
        compilation_promise__resolve();
    });

    webpack_config = deep_copy(webpack_config);
    const {watching, server_start_promise, ...compiler_handler_return} = compiler_handler({webpack_compiler, webpack_config, webpack_compiler_error_handler});
    assert_internal((watching===null || watching) && server_start_promise);

    const stop_build = async () => {
        if( watching ) {
            const {promise, promise_resolver} = gen_promise_with_resolver();
            watching.close(promise_resolver);
            await promise;
        }
        await wait_build();
    };

    return {stop_build, wait_build, server_start_promise};

    /*
    let webpack_stats = await first_compilation;

 // handle_logging({onCompileStart, onCompileEnd, webpack_stats, webpack_config, log_progress, log_config_and_stats});

    webpack_stats = await first_successful_compilation;

    return;
    */

    async function get_compiler_info({webpack_stats, is_success}) {
        const dist_info = (
            get_dist_info({
                config: webpack_config,
                webpack_stats,
            })
        );
        assert_internal(dist_info);

        const htmlBuilder = get_html_builder({dist_info});

        return {webpack_stats, is_success, output: dist_info, htmlBuilder, ...compiler_handler_return};
    }

    function webpack_compiler_error_handler(err/*, webpack_stats*/) {
        if( err ){
            log_config(webpack_config);
            log('');
            print_err(err.stack || err);
            if (err.details) {
                print_err(err.details);
            }
        }
    }
}

/*
function handle_logging({onCompileStart, onCompileEnd, webpack_stats: stats__initial, webpack_config, log_progress, log_config_and_stats}) {
        let is_erroneous = stats__initial.hasErrors();

        if( is_erroneous || log_config_and_stats ) {
            process.stdout.write('\n');
            log_config(webpack_config);
            process.stdout.write('\n');
            log_webpack_stats(stats__initial);
        }

        onCompileStart.addListener(() => {
            if( !log_progress && !is_erroneous ) {
                return;
            }
            const msg = is_erroneous ? 'Retrying' : 'Re-building';
            process.stdout.write(msg+'... ');
        });

        onCompileEnd.addListener(stats__new => {
            const was_erroneous = is_erroneous;
            is_erroneous = stats__new.hasErrors();
            if( !log_progress && !is_erroneous ) {
                return;
            }
            if( is_erroneous ) {
                process.stdout.write('\n');
                log_stats_errors({webpack_stats: stats__new}));
                process.stdout.write('\n');
                return;
            }
            const msg = was_erroneous ? 'Success' : 'Done';
            if( ! is_erroneous ) {
                const prefix = ''+green_checkmark()+' ';
                print(prefix+msg);
            }
        });
}
*/

function get_webpack_compiler(webpack_config) {
    let resolve_first_compilation;
    const first_compilation = (
        new Promise(resolve => {
            resolve_first_compilation = resolve;
        })
    );

    let resolve_first_successful_compilation;
    const first_successful_compilation = (
        new Promise(resolve => {
            resolve_first_successful_compilation = resolve;
        })
    );

    const onCompileStartListeners = [];
    const onCompileStart = {addListener(fn){onCompileStartListeners.push(fn)}};
    const onCompileEndListeners = [];
    const onCompileEnd = {addListener(fn){onCompileEndListeners.push(fn)}};

    const webpack_compiler = call_webpack(webpack_config);

    // infos about `webpack_compiler.plugin(eventName)`;
    // - https://github.com/webpack/webpack-dev-server/issues/847
    // - https://github.com/webpack/webpack-dev-server/blob/master/lib/Server.js
    webpack_compiler.hooks.compile.tap('UnusedName'+Math.random(), () => {
        onCompileStartListeners.forEach(fn => fn());
    });

    DEBUG_WATCH && print_changed_files(webpack_compiler);

    webpack_compiler.hooks.done.tap('UnusedName'+Math.random(), webpack_stats => {
        resolve_first_compilation(webpack_stats);

        // Error handling reference;
        // https://webpack.js.org/api/node/#error-handling
        const is_success =  !webpack_stats.hasErrors();

        if( is_success ) {
            resolve_first_successful_compilation(webpack_stats);
        }
        onCompileEndListeners.forEach(fn => fn({webpack_stats, is_success}));
    });

 // webpack_mild_compile(webpack_compiler);

    return {webpack_compiler, first_compilation, first_successful_compilation, onCompileStart, onCompileEnd};
}

function print_changed_files(webpack_compiler) {
    const mem = {
        startTime: Date.now(),
        prevTimestamps: {},
    };
    webpack_compiler.hooks.emit.tap('uehwiqe', (compilation, cb) => {
        const fileTs = {};
        [...compilation.fileTimestamps.keys()].forEach(key => {
            fileTs[key] = compilation.fileTimestamps.get(key);
            assert_internal(key);
            assert_internal(fileTs[key]);
        });
        var changedFiles = Object.keys(fileTs).filter(function(watchfile) {
            const ts = fileTs[watchfile];
            return (mem.prevTimestamps[watchfile] || mem.startTime) < (fileTs[watchfile] || Infinity);
        });

        if( changedFiles.length > 0 ) {
            console.log('\nFiles with new timestamps:\n', changedFiles);
        }

        mem.prevTimestamps = compilation.fileTimestamps;
    });
}

function call_webpack(webpack_config) {
    try {
        const webpack_compiler = webpack(webpack_config);
        return webpack_compiler;
    } catch(e) {
        if( e.toString().toLowerCase().includes('invalid conf') ) {
            log_config(webpack_config);
        }
        throw e;
    }
}

function log_config(config) {
    log_title('Webpack Config');
    log(config);
}

async function build_index_html({compilation_info}) {
    const compiler_info = compilation_info[0]||{};
    const {output} = compiler_info;
    assert_internal(output, compilation_info);
    const html = await get_generic_html({dist_info: output});
    assert_internal(html.constructor===String);
    return write_html_file({dist_info: output, pathname: '/', html});
}

async function get_generic_html({dist_info}) {
    const {styles, scripts} = get_index_assets({dist_info});
    assert(styles.constructor===Array);
    assert(scripts.constructor===Array);

    const html = await HtmlCrust.renderToHtml({styles, scripts});

    return html;
}

function get_html_builder({dist_info}) {
    return ({pathname, html}) => {
        assert_usage(pathname.startsWith('/'));
        assert_usage(html && html.constructor===String, html);
        return write_html_file({dist_info, pathname, html});
    };
}

async function write_html_file({dist_info, pathname='/', html}) {
    assert(dist_info);
    assert(pathname.startsWith('/'), pathname);
    assert(html.constructor===String, html);

    const filedir = dist_info.dist_root_directory;
    assert(filedir, dist_info, filedir);
    assert(filedir.startsWith('/'));

    const filepath_rel = pathname === '/' ? '/index' : pathname;
    const filepath = path_module.join(filedir, '.'+filepath_rel+'.html');

    fs__write_file(filepath, html);

    return filepath;
}

function get_index_assets({dist_info}) {
    let index_bundle_name;
    const bundle_names = Object.keys(dist_info.entry_points);
    if( bundle_names.length === 1 ) {
        index_bundle_name = bundle_names[0];
    } else {
        index_bundle_name = (
            bundle_names.includes('/') && '/' ||
            bundle_names.includes('index') && 'index' ||
            bundle_names.includes('main') && 'main'
        )
    }
    assert_usage(
        index_bundle_name,
        dist_info,
        "Couldn't find assets for `index.html` from output/distribution information printed above.",
    );

    const {styles, scripts}  = dist_info.entry_points[index_bundle_name];
    return {styles, scripts};
}

function get_dist_info(args) {
    const {config, webpack_stats} = args;
    assert_internal(webpack_stats, args);
    assert_internal(config, args);

    const dist_root_directory = get_dist_root_directory({config});
    assert_internal(dist_root_directory, config, dist_root_directory);

    const entry_points = get_dist_entry_points({config, webpack_stats, dist_root_directory});

    const {port} = config.devServer||{};
    const served_at = port ? 'http://localhost:'+port : null;

 // debug_webpack_stats(webpack_stats);

    const dist_info = {
        entry_points,
        dist_root_directory,
        served_at,
    };

    return dist_info;

}

function debug_webpack_stats(webpack_stats) {
    log_title('Webpack Compilation Info');
    // The two intersting objects are
    //  - webpack_stats.toJson().entrypoints
    //  - webpack_stats.toJson().assetsByChunkName

    print(webpack_stats.toJson().entrypoints);
    return;
    log(webpack_stats.toJson().chunks);
    print(webpack_stats.toJson().chunks);
    print(webpack_stats.toJson().chunks.map(c => c.origins));
    print(webpack_stats.toJson().entrypoints);
    return;
    print(webpack_stats.toJson().assetsByChunkName);
    return;
 // print(webpack_stats.compilation.assets);
    print(Object.keys(webpack_stats.compilation.assets));
    print(Object.keys(webpack_stats.compilation).sort());
    print(Object.keys(webpack_stats.toJson()).sort());
 // print(webpack_stats.toJson());
    print(webpack_stats.toJson().assets);
    print(webpack_stats.toJson().chunks);
 // print(webpack_stats.toJson().children);
    print(webpack_stats.toJson().entrypoints);
    print(webpack_stats.toJson().filteredAssets);
    throw 'rueh';
 // print(webpack_stats.toJson().modules);
    print(webpack_stats.toJson().assetsByChunkName);
}

function print() {
    /*
    readline.clearLine(process.stdout);
    readline.cursorTo(process.stdout, 0);
    */
    console.log.apply(console, arguments);
}

function print_err() {
    console.error.apply(console, arguments);
}

function get_dist_root_directory({config}) {
    let dist_root_directory = config.output.path;
    /*
    if( ! fs__directory_exists(dist_root_directory) ) {
        return null;
    }
    */
    if( ! dist_root_directory.endsWith('/') ) {
        dist_root_directory += '/';
    }
    return dist_root_directory;
}

function get_styles_and_scripts({all_assets}) {
    const styles = [];
    const scripts = [];

    all_assets
    .forEach(asset => {
        const {served_as} = asset;
        assert_internal(served_as.startsWith('/'));
        const {asset_type} = asset;
        assert_internal(asset_type, asset);
        if( asset_type === 'script' ) {
            scripts.push(served_as);
        }
        if( asset_type === 'style' ) {
            styles.push(served_as);
        }
    });

    return {styles, scripts};
}

function get_dist_entry_points({config, webpack_stats, dist_root_directory}) {
    const entry_points = {};
    get_entries(config)
    .forEach(({entry_name, source_entry_points}) => {
        assert_internal(entry_name);
        assert_internal(source_entry_points.constructor===Array, config, source_entry_points, entry_name);

        const all_assets = get_all_entry_assets({entry_name, webpack_stats, dist_root_directory});

        const {scripts, styles} = get_styles_and_scripts({all_assets});

        entry_points[entry_name] = {
            entry_name,
            all_assets,
            scripts,
            styles,
            source_entry_points,
        };
    });

    return entry_points;
}

function get_entries(webpack_config) {
    assert_internal([Object, Array, String].includes(webpack_config.entry.constructor));

    const entries = (() => {
        if( webpack_config.entry.constructor === String ) {
            return [['main', [webpack_config.entry]]];
        }
        if( webpack_config.entry.constructor === Array ) {
            return [['main', webpack_config.entry]];
        }
        if( webpack_config.entry.constructor === Object ) {
            return Object.entries(webpack_config.entry);
        }
    })();
    assert_internal(entries);

    const entries__normalized = []
    entries.forEach(([entry_name, source_entry_points]) => {
        assert_internal((entry_name||{}).constructor===String, webpack_config, entry_name);
        assert_internal([String, Array].includes((source_entry_points||{}).constructor), webpack_config, source_entry_points, entry_name);
        if( source_entry_points.constructor===String ) {
            source_entry_points = [source_entry_points];
        }
        source_entry_points = source_entry_points.map(src_entry => {
            if( src_entry.startsWith('/') ) {
                return src_entry;
            }
            const {context} = webpack_config;
            assert_usage(
                context,
                webpack_config,
                "Can't compute the absolute path of `"+src_entry+"` because `context` is not defined in the webpack configuration.",
                "The webpack configuration in question is printed above."
            );
            assert_usage(
                context.constructor===String && context.startsWith('/'),
                webpack_config,
                "We expect the `context` property of the webpack configuration above to be an absolute path."
            );
            return path_module.resolve(context, src_entry);
        });
        entries__normalized.push({entry_name, source_entry_points});
    });

    return entries__normalized;
}

function get_all_entry_assets({entry_name, webpack_stats, dist_root_directory}) {
    const webpack_stats_json = webpack_stats.toJson();
    const {entrypoints, publicPath, errors} = webpack_stats_json


    const entry_point = entrypoints[entry_name];

    if( errors && errors.length && ! entry_point ) {
        return [];
    }

    assert_internal(entry_point, entrypoints, entry_point, entry_name);
    const filenames = entry_point.assets;
    assert_internal(filenames, entrypoints, entry_name);

    return (
        (filenames instanceof Array ? filenames : [filenames])
        .map(filename => {
            assert_internal(filename, entrypoints);
            const path = dist_root_directory && path_module.resolve(dist_root_directory, './'+filename);
            const exists = fs__file_exists(path);
            const filepath = path && exists && path;
            const asset_type = get_asset_type(filename, entry_point);
            return {
                asset_type,
                filename,
                filepath,
                served_as: publicPath+filename,
            };
        })
    );
}

function get_asset_type(filename, ep) {
    if( filename.endsWith('.js') || filename.endsWith('mjs') ) {
        return 'script';
    }
    if( filename.endsWith('wasm') ) {
        return 'wasm';
    }
    if( filename.endsWith('.css') ) {
        return 'style';
    }
    if( filename.endsWith('.map') ) {
        return 'sourcemap';
    }
    assert_internal(
        false,
        ep,
        "We don't know how to determine the type of one of the assets of the entry point printed above.",
        "Unknown file extension for `"+filename+"`.",
    );
}

function fs__write_file(file_path, file_content) {
    assert_internal(file_path.startsWith('/'));
    mkdirp.sync(path_module.dirname(file_path));
    // Using `require('mz/fs').writeFile` breaks error stack trace
    fs.writeFileSync(file_path, file_content);
}

function fs__directory_exists(path) {
    try {
        return fs.statSync(path).isDirectory();
    }
    catch(e) {
        return false;
    }
}

function fs__file_exists(path) {
    try {
        return fs.statSync(path).isFile();
    }
    catch(e) {
        return false;
    }
}

function debug_config(config) {
    // Bisection debugging
    /* doesn't work
    config = {
        entry: {
            main: ['/home/romu/code/stem/docs/frontend/src/index.js'],
        },
        entry: config.entry,
        output: {
            publicPath: config.output.publicPath,
            path: '/home/romu/code/stem/docs/frontend/dist/',
            filename: 'bundi_[name].js',
            libraryTarget: 'umd',
        },
        output: config.output,
        devServer: {
            port: config.devServer.port,
            publicPath: config.devServer.publicPath,
        },
        devServer: config.devServer,
        plugins: config.plugins,
        module: config.module,
        resolve: config.resolve,
        resolveLoader: config.resolveLoader,
    };

    config = {
        entry: config.entry,
        output: config.output,
        devServer: {
            port: config.devServer.port,
            publicPath: config.devServer.publicPath,
        },
        plugins: config.plugins,
        devServer: config.devServer,
        plugins: config.plugins,
        module: config.module,
        resolve: config.resolve,
        resolveLoader: config.resolveLoader,
    };

    */

    // works
    config.output.filename = '[name]-bundi.js';

    /* works
    config.output.filename = 'bundle.js';

    config.output = {
        publicPath: '/',
        path: '/home/romu/code/stem/src/plugins/stem-build-frontend/test/frontend/dist',
        filename: 'bundle.js',
        libraryTarget: 'umd',
    };

    config = {
        entry: config.entry,
        output: {
            publicPath: '/',
            path: '/home/romu/code/stem/src/plugins/stem-build-frontend/test/frontend/dist',
            filename: 'bundle.js',
            libraryTarget: 'umd',
        },
        devServer: {
            port: config.devServer.port,
            publicPath: config.devServer.publicPath,
        },
        plugins: config.plugins,
        devServer: config.devServer,
        plugins: config.plugins,
        module: config.module,
        resolve: config.resolve,
        resolveLoader: config.resolveLoader,
    };

    config = {
        entry: '/home/romu/code/stem/src/plugins/stem-build-frontend/test/frontend/src/index.js',
        entry: config.entry,
        output: {
            publicPath: '/',
            path: '/home/romu/code/stem/src/plugins/stem-build-frontend/test/frontend/dist',
            filename: 'bundle.js',
            libraryTarget: 'umd',
        },
        devServer: {
            port: config.devServer.port,
            publicPath: config.devServer.publicPath,
        },
        plugins: config.plugins,
    };
    */

    return config;
}

function gen_promise_with_resolver() {
    let promise_resolver;
    const promise = new Promise(resolve => promise_resolver=resolve);
    assert_internal(promise_resolver);
    return {promise, promise_resolver};
}