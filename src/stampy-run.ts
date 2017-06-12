import * as commander from "commander";
import * as Config from "./config";
import {getConfig} from "./config";
import {BaseContext, Plugin, Plugins, RequirePluginContext, Script, ScriptRef} from "../types";
import {ScriptsRequirePlugin} from "./plugins/require/scripts";
import * as _ from "lodash";
import * as fs from "fs-extra";
import * as path from "path";
import {loadScripts} from "./script-loader";
import {execute} from "./executor";
import {HasRolesRunIfPlugin} from "./plugins/runIf/has-roles";
import {ExprRunIfPlugin} from "./plugins/runIf/expr";
import {FilesRequirePlugin} from "./plugins/require/files";
import * as NestedError from "nested-error-stacks";
import {log} from "./log";
import * as glob from "glob";
import {OnceRunIfPlugin} from "./plugins/runIf/once";

export async function run(argv: string[]): Promise<void> {
    const args = commander
        .version('0.1.0')
        .usage('[options] <file|commands ...>')
        .option('-c, --config <file>', 'Configuration file')
        .option('-r, --role <role>', 'Role to run', collect, null)
        .option('-o, --output <file>', 'Output file')
        .option('--outputFormat [normal|json]', 'Specify how the output should look', 'normal')
        .parse(argv);

    let outputFileFD: number = null;
    if (args.output) {
        outputFileFD = await openOutputFile(args.output);
    }

    const config = await getConfig(args.config);
    const ctx: any = {
        cwd: path.resolve(path.dirname(config)),
        configFile: config,
        commandLineArgs: args,
        rolesToRun: args.role,
        outputFormat: args.outputFormat,
        outputFileFD: outputFileFD,
        log: null
    };

    ctx.log = log.bind(null, ctx, null);
    ctx.config = await Config.load(ctx.configFile);
    await validate(ctx);
    const initialScripts = await findInitialScripts(ctx);
    ctx.plugins = await loadPlugins(ctx);
    ctx.scripts = await loadScripts(ctx, initialScripts);
    validateScripts(ctx.scripts);
    await execute(ctx);

    if (ctx.outputFileFD) {
        fs.closeSync(ctx.outputFileFD);
    }
}

async function openOutputFile(fileName: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        fs.open(fileName, 'w', (err, fd) => {
            if (err) {
                return reject(err);
            }
            resolve(fd);
        });
    });
}

async function validate(ctx: BaseContext): Promise<void> {
    validateRolesToRun(ctx, ctx.rolesToRun);
}

function validateScripts(scripts: Script[]) {
    for (let script of scripts) {
        validateScriptCircularDependencies([script]);
        if (script.requires) {
            validateScripts(script.requires);
        }
    }
}

function validateScriptCircularDependencies(scriptPath: Script[]) {
    for (let child of scriptPath[scriptPath.length - 1].requires) {
        for (let s of scriptPath) {
            if (s === child) {
                throw new Error(`Circular dependency detected from script "${s.path}"`);
            }
        }
        validateScriptCircularDependencies(scriptPath.concat([child]));
    }
}

function validateRolesToRun(ctx: BaseContext, rolesToRun: string[]) {
    if (!rolesToRun) {
        return;
    }
    for (let roleToRun of rolesToRun) {
        if (!ctx.config.roles[roleToRun]) {
            throw new Error(`Could not find role ${roleToRun}`);
        }
    }
}

async function findInitialScripts(ctx: BaseContext): Promise<ScriptRef[]> {
    let args = ctx.commandLineArgs.args;
    if (args.length === 0) {
        if (ctx.config.commands['default']) {
            args = ['default'];
        } else {
            throw new Error('No commands, scripts, or default command specified');
        }
    }

    const scripts = await Promise.all(
        args.map(arg => {
            const cmd = ctx.config.commands[arg];
            if (!cmd) {
                return Promise.resolve([{
                    basePath: ctx.cwd,
                    requirePluginName: 'script',
                    args: [arg]
                }]);
            }

            return Promise.resolve(cmd.scripts.map(c => {
                return {
                    basePath: ctx.cwd,
                    requirePluginName: 'script',
                    args: [c]
                }
            }));
        })
    );
    return _.flatten(scripts);
}

async function loadPlugins(ctx: RequirePluginContext): Promise<Plugins> {
    const plugins: Plugins = {
        require: {
            scripts: new ScriptsRequirePlugin(),
            script: new ScriptsRequirePlugin(),
            files: new FilesRequirePlugin(),
            file: new FilesRequirePlugin()
        },
        'run-if': {
            'has-roles': new HasRolesRunIfPlugin(),
            expr: new ExprRunIfPlugin(),
            once: new OnceRunIfPlugin()
        }
    };

    _.merge(plugins, await loadNodeModulePlugins(ctx));
    _.merge(plugins, await loadConfigPlugins(ctx));

    return Promise.resolve(plugins);
}

async function loadNodeModulePlugins(ctx: RequirePluginContext): Promise<Plugins> {
    const results: Plugins = {
        require: {},
        'run-if': {}
    };
    const packageJsonFiles = await getPackageJsonFiles();
    for (let packageJsonFile of packageJsonFiles) {
        const content = JSON.parse(await fs.readFile(packageJsonFile, 'utf8'));
        if (content.stampy && content.stampy.plugins) {
            const packageJsonDir = path.dirname(packageJsonFile);
            const plugins = content.stampy.plugins;
            ['require', 'run-if'].forEach(pluginType => {
                for (let name in plugins[pluginType] || {}) {
                    const Plugin = require(path.join(packageJsonDir, plugins[pluginType][name]));
                    results[pluginType][name] = new Plugin();
                }
            });
        }
    }
    return results;

    function getPackageJsonFiles(): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const globOptions = {
                cwd: ctx.cwd,
                nodir: true
            };
            glob('**/package.json', globOptions, (err, files) => {
                if (err) {
                    return reject(err);
                }
                return resolve(files.map(f => path.join(ctx.cwd, f)));
            });
        });
    }
}

async function loadConfigPlugins(ctx: RequirePluginContext): Promise<Plugins> {
    const results: Plugins = {
        require: {},
        'run-if': {}
    };
    for (let group in ctx.config.plugins || {}) {
        for (let name in ctx.config.plugins[group]) {
            results[group][name] = await loadPlugin(ctx, ctx.config.plugins[group][name]);
        }
    }
    return results;
}

async function loadPlugin(ctx: RequirePluginContext, fileName: string): Promise<Plugin> {
    const fullFileName = path.resolve(ctx.cwd, fileName);
    const Plugin = require(fullFileName);
    try {
        return new Plugin();
    } catch (err) {
        throw new NestedError(`Could not load plugin "${fullFileName}"`, err);
    }
}

function collect(val, memo) {
    if (!memo) {
        memo = [];
    }
    memo.push(val);
    return memo;
}
