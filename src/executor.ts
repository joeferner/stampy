import {BaseContext, CommandPlugin, ContextPlugin, ExecutionContext, ExecutionContextState, Script} from "../types";
import * as _ from "lodash";
import * as path from "path";
import {calculateExecutionOrder} from "./execution-order";
import * as chalk from "chalk";
import {log} from "./log";
import {copyFile, executeCommand, getSshClient, runCommand} from "./utils/remote";
import {performSubstitutions} from "./config";

export async function execute(ctx: BaseContext): Promise<void> {
    ctx.scripts = ctx.scripts || [];

    const cmd = <CommandPlugin>ctx.command.commandPlugin;
    if (cmd.preExecution) {
        if (!await cmd.preExecution(ctx)) {
            return;
        }
    }

    if (ctx.scripts.length == 0) {
        return;
    }

    const executionContexts = await getExecutionContexts(ctx);
    const colorFnQueue: any = [
        chalk.green,
        chalk.cyan,
        chalk.yellow.bold,
        chalk.magenta,
        chalk.red,
        chalk.blue.bold
    ];
    for (let ctx of executionContexts) {
        ctx.logColorHostFn = colorFnQueue.shift();
        try {
            if (!ctx.local) {
                ctx.sshClient = await getSshClient(ctx);
            }
            ctx.state = ExecutionContextState.CONNECTED;
            ctx.scripts = await calculateExecutionOrder(ctx, ctx.scripts);
            await executeLifecycleAfterConnect(ctx);
            await syncFiles(ctx);
            ctx.state = ExecutionContextState.FILES_SYNCED;
            await executeLifecycleAfterFilesSynced(ctx);
            if (cmd.execute) {
                await cmd.execute(ctx, ctx.commandLineArgs.commandArgs);
            }
            await executeLifecycleAfterExecution(ctx);
            if (ctx.sshClient) {
                await ctx.sshClient.end();
            }
            ctx.state = ExecutionContextState.DISCONNECTED;
        } finally {
            colorFnQueue.push(ctx.logColorHostFn);
        }
    }
    log(ctx, null, 'DONE');
}

function executeLifecycleAfterConnect(ctx: ExecutionContext): Promise<void> {
    return executeLifecycle(ctx, 'afterConnect');
}

function executeLifecycleAfterFilesSynced(ctx: ExecutionContext): Promise<void> {
    return executeLifecycle(ctx, 'afterFilesSynced');
}

function executeLifecycleAfterExecution(ctx: ExecutionContext): Promise<void> {
    return executeLifecycle(ctx, 'afterExecution');
}

async function executeLifecycle(ctx: ExecutionContext, fnName: string): Promise<void> {
    for (let pluginName of Object.keys(ctx.plugins.lifecycle)) {
        const plugin = ctx.plugins.lifecycle[pluginName];
        if (plugin[fnName]) {
            await plugin[fnName](ctx);
        }
    }
}

async function getExecutionContexts(ctx: BaseContext): Promise<ExecutionContext[]> {
    const results: { [host: string]: ExecutionContext } = {};
    for (let roleName in ctx.config.roles) {
        if (!shouldRoleRun(ctx, roleName)) {
            continue;
        }
        const roleInfo = ctx.config.roles[roleName];
        for (let host of roleInfo.hosts) {
            if (!shouldHostRun(ctx, host)) {
                continue;
            }
            if (results[host]) {
                results[host].roles.push(roleName);
            } else {
                results[host] = {
                    ...ctx,
                    state: ExecutionContextState.INITIALIZING,
                    host,
                    local: false,
                    sshOptions: {
                        ...ctx.config.defaults.ssh
                    },
                    options: {
                        env: {},
                        ...ctx.config.defaults
                    },
                    roles: [roleName],
                    exec: null,
                    run: null,
                    copyFile: null,
                    logWithScript: null,
                    logColorHostFn: null
                };
            }
        }
    }
    let executionContexts = _.values(results);
    for (let ctx of executionContexts) {
        ctx.local = isLocal(ctx);
        ctx.exec = executeCommand.bind(null, ctx);
        ctx.run = runCommand.bind(null, ctx);
        ctx.logWithScript = log.bind(null, ctx);
        ctx.copyFile = copyFile.bind(null, ctx);
        await
            applyContextPlugins(ctx.plugins.context, ctx);
        await
            performSubstitutions(ctx, ctx);
    }
    return executionContexts;
}

async function applyContextPlugins(contextPlugins: { [name: string]: ContextPlugin }, ctx: ExecutionContext) {
    for (let contextPluginName in contextPlugins) {
        const contextPlugin = contextPlugins[contextPluginName];
        if (contextPlugin.applyToExecutionContext) {
            await contextPlugin.applyToExecutionContext(ctx);
        }
    }
}

function syncFiles(ctx: ExecutionContext): Promise<void> {
    if (ctx.local) {
        return syncFilesLocal(ctx);
    } else {
        return syncFilesRemote(ctx);
    }
}

async function syncFilesLocal(ctx: ExecutionContext): Promise<void> {
    for (let script of ctx.scripts) {
        await syncScript(ctx, script);
    }
    for (let include of ctx.includes) {
        await copyFile(
            ctx,
            null,
            {
                fullPath: path.join(ctx.baseDir, include),
                packagePath: include
            }
        );
    }

    async function syncScript(ctx: ExecutionContext, script: Script): Promise<void> {
        await copyFile(ctx, script, script.path);
        for (let file of script.files) {
            await copyFile(ctx, script, file);
        }
    }
}

function syncFilesRemote(ctx: ExecutionContext): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        syncFilesToClient(ctx, ctx.scripts)
            .then(() => {
                resolve();
            })
            .catch((err) => {
                reject(err);
            });

        async function syncFilesToClient(ctx: ExecutionContext, scripts: Script[]): Promise<void> {
            for (let script of scripts) {
                await syncScript(ctx, script);
            }
            for (let include of ctx.includes) {
                await copyFile(
                    ctx,
                    null,
                    {
                        fullPath: path.join(ctx.baseDir, include),
                        packagePath: include
                    }
                );
            }
        }

        async function syncScript(ctx: ExecutionContext, script: Script): Promise<void> {
            await copyFile(ctx, script, script.path);
            for (let file of script.files) {
                await copyFile(ctx, script, file);
            }
        }
    });
}

function isLocal(ctx: ExecutionContext): boolean {
    return ctx.host === 'localhost' || ctx.host === '127.0.0.1';
}

function shouldRoleRun(ctx: BaseContext, roleName: string): boolean {
    return !ctx.rolesToRun || ctx.rolesToRun.indexOf(roleName) >= 0;
}

function shouldHostRun(ctx: BaseContext, host: string): boolean {
    return !ctx.hostsToRun || ctx.hostsToRun.indexOf(host) >= 0;
}
