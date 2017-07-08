import * as Config from "./config";
import {getConfig} from "./config";
import {BaseContext, ContextPlugin, Plugin, PLUGIN_TYPES, Plugins} from "../types";
import {ScriptsRequirePlugin} from "./plugins/require/scripts";
import {LocalScriptsRunPlugin} from "./plugins/run/local-scripts";
import {EjsRunPlugin} from "./plugins/run/ejs";
import * as _ from "lodash";
import * as fs from "fs-extra";
import * as path from "path";
import {HasRolesRunIfPlugin} from "./plugins/runIf/has-roles";
import {ExprRunIfPlugin} from "./plugins/runIf/expr";
import {FilesRequirePlugin} from "./plugins/require/files";
import * as NestedError from "nested-error-stacks";
import {log} from "./log";
import * as glob from "glob";
import {OnceRunIfPlugin} from "./plugins/runIf/once";
import {ExternalFileRequirePlugin} from "./plugins/require/external-file";
import {ExistsRunIfPlugin} from "./plugins/runIf/exists";
import {CmdRunIfPlugin} from "./plugins/runIf/cmd";
import {GpgContextPlugin} from "./plugins/context/gpg";
import {DefaultCommandPlugin} from "./plugins/command/DefaultCommandPlugin";
import {commandLineParse} from "./utils/command-line";
import {YumRunPlugin} from "./plugins/run/YumRunPlugin";
import {CommandCommandPlugin} from "./plugins/command/CommandCommandPlugin";

export async function run(argv: string[]): Promise<void> {
    argv = argv.slice(2);
    const args = commandLineParse([
        {name: 'config', alias: 'c', type: String},
        {name: 'role', alias: 'r', multiple: true, type: String},
        {name: 'host', multiple: true, type: String},
        {name: 'output', alias: 'o', type: String},
        {name: 'group', alias: 'g', multiple: true, type: String, defaultValue: []},
        {name: 'dry-run', type: Boolean, defaultValue: false},
        {name: 'output-format', type: String, defaultValue: 'normal'},
        {name: 'args', defaultOption: true, multiple: true, defaultValue: []}
    ], {argv, partial: true});

    let outputFileFD: number = null;
    if (args.output) {
        outputFileFD = await openOutputFile(args.output);
    }

    const config = await getConfig(args.config);
    const configDir = path.resolve(path.dirname(config));
    const ctx: any = {
        baseDir: configDir,
        cwd: configDir,
        configFile: config,
        commandLineArgs: args,
        rolesToRun: args.role,
        hostsToRun: args.host,
        groups: args.group,
        outputFormat: args['output-format'],
        outputFileFD: outputFileFD,
        log: null,
        dryRun: args['dry-run'],
        pluginData: {},
        commands: []
    };

    ctx.log = log.bind(null, ctx, null);
    ctx.config = await Config.load(ctx.configFile, ctx.groups);
    await addIncludesDirectory(ctx);
    await validate(ctx);
    ctx.plugins = await loadPlugins(ctx);
    await applyContextPlugins(ctx.plugins.context, ctx);
    ctx.commandLineArgs.commandArgs = await loadCommand(ctx);

    ctx.command.commandPlugin.run
        ? await ctx.command.commandPlugin.run(ctx, ctx.commandLineArgs.commandArgs)
        : DefaultCommandPlugin.runStatic(ctx, ctx.commandLineArgs.commandArgs);

    if (ctx.outputFileFD) {
        fs.closeSync(ctx.outputFileFD);
    }
}

async function addIncludesDirectory(ctx: BaseContext): Promise<void> {
    const includesPath = path.join(ctx.baseDir, 'includes');
    let includes = ctx.config.includes;
    if (!includes) {
        if (await fs.pathExists(includesPath)) {
            includes = [path.join(includesPath, '/**')];
        } else {
            includes = [];
        }
    }
    ctx.includes = _.flatten(await Promise.all<string[]>(includes.map(i => {
        const globOptions = {
            cwd: ctx.baseDir,
            nodir: true
        };
        return new Promise((resolve, reject) => {
            glob(i, globOptions, (err, files) => {
                if (err) {
                    return reject(err);
                }
                resolve(files.map(f => path.relative(ctx.baseDir, f)));
            });
        });
    })));
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
    validateHostsToRun(ctx, ctx.hostsToRun);
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

function validateHostsToRun(ctx: BaseContext, hostsToRun: string[]) {
    if (!hostsToRun) {
        return;
    }
    for (let hostToRun of hostsToRun) {
        let found = false;
        for (let roleName of Object.keys(ctx.config.roles)) {
            const role = ctx.config.roles[roleName];
            if (role.hosts.indexOf(hostToRun) >= 0) {
                found = true;
            }
        }
        if (!found) {
            throw new Error(`Could not find host ${hostToRun} in any roles`);
        }
    }
}

async function loadCommand(ctx: BaseContext): Promise<string[]> {
    let args = ctx.commandLineArgs.args;
    if (args.length === 0) {
        if (ctx.config.commands['default']) {
            args = ['default'];
        } else {
            throw new Error('No commands, scripts, or default command specified');
        }
    }

    ctx.command = ctx.config.commands[args[0]];
    if (ctx.command) {
        args = args.slice(1);
    } else {
        if (ctx.plugins.command[args[0]]) {
            ctx.command = {
                scripts: [],
                commandPlugin: ctx.plugins.command[args[0]]
            };
            args = args.slice(1);
            return args;
        } else {
            ctx.command = {
                scripts: []
            };
        }
    }

    if (!ctx.command.commandPlugin) {
        ctx.command.commandPlugin = new DefaultCommandPlugin();
    } else if (typeof ctx.command.commandPlugin === 'string') {
        const commandPlugin = ctx.plugins.command[ctx.command.commandPlugin];
        if (!commandPlugin) {
            throw new Error(`Could not find command plugin "${ctx.command.commandPlugin}"`);
        }
        ctx.command.commandPlugin = commandPlugin;
    }

    return args;
}

async function loadPlugins(ctx: BaseContext): Promise<Plugins> {
    const plugins: Plugins = {
        context: {
            gpg: new GpgContextPlugin()
        },
        require: {
            scripts: new ScriptsRequirePlugin(),
            script: new ScriptsRequirePlugin(),
            files: new FilesRequirePlugin(),
            file: new FilesRequirePlugin(),
            'external-file': new ExternalFileRequirePlugin()
        },
        'run-if': {
            'has-role': new HasRolesRunIfPlugin(),
            'has-roles': new HasRolesRunIfPlugin(),
            expr: new ExprRunIfPlugin(),
            exists: new ExistsRunIfPlugin(),
            cmd: new CmdRunIfPlugin(),
            once: new OnceRunIfPlugin()
        },
        run: {
            'local-script': new LocalScriptsRunPlugin(),
            'local-scripts': new LocalScriptsRunPlugin(),
            ejs: new EjsRunPlugin(),
            yum: new YumRunPlugin()
        },
        command: {
            'default': new DefaultCommandPlugin(),
            cmd: new CommandCommandPlugin()
        },
        lifecycle: {}
    };

    _.merge(plugins, await loadNodeModulePlugins(ctx));
    _.merge(plugins, await loadConfigPlugins(ctx));

    return Promise.resolve(plugins);
}

async function applyContextPlugins(contextPlugins: { [name: string]: ContextPlugin }, ctx: BaseContext) {
    for (let contextPluginName in contextPlugins) {
        const contextPlugin = contextPlugins[contextPluginName];
        if (contextPlugin.applyToBaseContext) {
            await contextPlugin.applyToBaseContext(ctx);
        }
    }
}

async function loadNodeModulePlugins(ctx: BaseContext): Promise<Plugins> {
    const results: Plugins = {
        context: {},
        require: {},
        'run-if': {},
        run: {},
        command: {},
        lifecycle: {}
    };
    const packageJsonFiles = await getPackageJsonFiles();
    for (let packageJsonFile of packageJsonFiles) {
        const content = JSON.parse(await fs.readFile(packageJsonFile, 'utf8'));
        if (content.stampy && content.stampy.plugins) {
            const packageJsonDir = path.dirname(packageJsonFile);
            const plugins = content.stampy.plugins;
            PLUGIN_TYPES.forEach(pluginType => {
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

async function loadConfigPlugins(ctx: BaseContext): Promise<Plugins> {
    const results: Plugins = {
        context: {},
        require: {},
        'run-if': {},
        run: {},
        command: {},
        lifecycle: {}
    };
    for (let group in ctx.config.plugins || {}) {
        for (let name in ctx.config.plugins[group]) {
            results[group][name] = await loadPlugin(ctx, ctx.config.plugins[group][name]);
        }
    }
    return results;
}

async function loadPlugin(ctx: BaseContext, fileName: string): Promise<Plugin> {
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
