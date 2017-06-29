import {BaseContext, ExecutionContext, FileRef, RunPlugin, Script} from "../types";
import * as _ from "lodash";
import * as path from "path";
import {calculateExecutionOrder} from "./execution-order";
import * as rjson from "relaxed-json";
import * as chalk from "chalk";
import {log} from "./log";
import * as NestedError from "nested-error-stacks";
import {isUndefined} from "util";
import {copyFile, executeCommand, getScpClient, getSshClient} from "./utils/remote";

export async function execute(ctx: BaseContext): Promise<void> {
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
                ctx.client = await getSshClient(ctx);
                ctx.scpClient = await getScpClient(ctx);
                ctx.scpClient.on('error', err => {
                    throw new NestedError('scp error', err);
                });
            }
            ctx.scripts = await calculateExecutionOrder(ctx, ctx.scripts);
            await syncFiles(ctx);
            await executeScripts(ctx);
            if (ctx.client) {
                ctx.client.end();
                ctx.scpClient.close();
            }
        } finally {
            colorFnQueue.push(ctx.logColorHostFn);
        }
    }
    log(ctx, null, 'DONE');
}

async function getExecutionContexts(ctx: BaseContext): Promise<ExecutionContext[]> {
    const results: { [host: string]: ExecutionContext } = {};
    for (let roleName in ctx.config.roles) {
        if (!shouldRoleRun(ctx, roleName)) {
            continue;
        }
        const roleInfo = ctx.config.roles[roleName];
        for (let host of roleInfo.hosts) {
            if (results[host]) {
                results[host].roles.push(roleName);
            } else {
                results[host] = {
                    ...ctx,
                    local: false,
                    sshOptions: {
                        ...ctx.config.defaults.ssh,
                        host
                    },
                    options: {
                        ...ctx.config.defaults
                    },
                    roles: [roleName],
                    exec: null,
                    copyFile: null,
                    log: null,
                    logColorHostFn: null
                };
            }
        }
    }
    let executionContexts = _.values(results);
    for (let ctx of executionContexts) {
        ctx.local = isLocal(ctx);
        ctx.exec = executeCommand.bind(null, ctx);
        ctx.log = log.bind(null, ctx);
        ctx.copyFile = copyFile.bind(null, ctx);
    }
    return executionContexts;
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

async function executeScripts(ctx: ExecutionContext): Promise<void> {
    for (let script of ctx.scripts) {
        if (await shouldExecuteScript(ctx, script)) {
            await executeScript(ctx, script);
            await executeScriptCompleteFunctions(ctx, script);
        } else {
            log(ctx, script, 'SKIP');
        }
    }
}

async function shouldExecuteScript(ctx: ExecutionContext, script: Script): Promise<boolean> {
    for (let line of script.stampyLines) {
        if (line.type === 'run-if' || line.type === 'skip-if') {
            const runIfPluginName = line.args[0];
            const runIfPlugin = ctx.plugins['run-if'][runIfPluginName];
            if (!runIfPlugin) {
                throw new Error(`Could not find 'run-if' plugin '${runIfPluginName}'`);
            }
            if (runIfPlugin.shouldExecute) {
                let result = await runIfPlugin.shouldExecute(ctx, script, line.args.slice(1));
                if (line.type === 'skip-if') {
                    result = !result;
                }
                if (!result) {
                    return false;
                }
            }
        }
    }
    return true;
}

async function executeScriptCompleteFunctions(ctx: ExecutionContext, script: Script): Promise<void> {
    if (ctx.dryRun) {
        return;
    }
    for (let line of script.stampyLines) {
        const pluginName = line.args[0];
        let type = line.type;
        if (type.endsWith("!")) {
            type = type.substring(0, type.length - 1);
        }
        if (type === 'skip-if') {
            type = 'run-if';
        }
        const pluginsForType = ctx.plugins[type];
        if (!pluginsForType) {
            throw new Error(`unexpected plugin type "${type}"`);
        }
        const plugin = pluginsForType[pluginName];
        if (!plugin) {
            throw new Error(`Could not find '${line.type}' plugin '${pluginName}'`);
        }
        if (plugin.scriptComplete) {
            await plugin.scriptComplete(ctx, script, line.args.slice(1), 0);
        }
    }
}

function reboot(ctx: ExecutionContext, script: Script, expr: any): Promise<void> {
    log(ctx, script, 'STDOUT', `Rebooting and waiting for ${expr.timeout} seconds`);
    return new Promise((resolve, reject) => {
        const rebootProcess = executeCommand(ctx, script, ctx.options.rebootCommand);
        rebootProcess.on('stdout', data => {
            log(ctx, script, 'STDOUT', data);
        });
        rebootProcess.on('stderr', data => {
            log(ctx, script, 'STDERR', data);
            reject(new Error(`could not execute reboot command "${ctx.options.rebootCommand}"`));
        });
        rebootProcess.on('close', code => {
            if (code === 0 || isUndefined(code)) {
                setTimeout(async () => {
                    ctx.client = await getSshClient(ctx);
                    ctx.scpClient = await getScpClient(ctx);
                    return resolve();
                }, expr.timeout * 1000);
            } else {
                reject(new Error(`could not execute reboot command "${ctx.options.rebootCommand}" (code: ${code})`));
            }
        });
    });
}

function executeScript(ctx: ExecutionContext, script: Script): Promise<void> {
    log(ctx, script, 'RUN');
    if (ctx.dryRun) {
        return Promise.resolve();
    }

    return executeRunLines(ctx, script)
        .then(async (additionalFiles: FileRef[]) => {
            for (let f of additionalFiles) {
                await copyFile(ctx, script, f);
            }
        })
        .then(() => {
            let rebooting = false;
            return new Promise<void>((resolve, reject) => {
                const ee = executeCommand(ctx, script, `./${path.basename(script.path.packagePath)}`);
                ee.on('stdout', data => {
                    const lines = (data + '')
                        .replace(/\r/g, '')
                        .replace(/\n$/, '')
                        .split('\n');
                    for (let line of lines) {
                        let m;
                        if (m = line.match(/^STAMPY:(.*)/)) {
                            const exprStr = m[1].trim();
                            const expr = JSON.parse(rjson.transform(exprStr));
                            switch (expr.action) {
                                case 'SKIP':
                                    log(ctx, script, 'SKIP');
                                    return resolve();
                                case 'REBOOT':
                                    rebooting = true;
                                    reboot(ctx, script, expr)
                                        .then(() => {
                                            resolve();
                                        })
                                        .catch((err) => {
                                            reject(err);
                                        });
                                    return;
                                default:
                                    return reject(new Error(`Invalid action received from script "${expr.action}"`));
                            }
                        }
                        log(ctx, script, 'STDOUT', line);
                    }
                });
                ee.on('stderr', data => {
                    log(ctx, script, 'STDERR', data);
                });
                ee.on('close', (code) => {
                    if (rebooting) {
                        return;
                    }
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`process "${script.path.packagePath}" exited with code ${code}`));
                    }
                });
            });
        });
}

async function executeRunLines(ctx: ExecutionContext, script: Script): Promise<FileRef[]> {
    let results = [];
    for (let line of script.stampyLines) {
        if (line.type === 'run') {
            const runPluginName = line.args[0];
            const runPlugin: RunPlugin = ctx.plugins['run'][runPluginName];
            if (!runPlugin) {
                throw new Error(`Could not find 'run' plugin '${runPluginName}'`);
            }
            const runResults = await runPlugin.run(ctx, script, line.args.slice(1));
            results = results.concat(runResults.files || []);
        }
    }
    return results;
}

function isLocal(ctx: ExecutionContext) {
    return ctx.sshOptions.host === 'localhost' || ctx.sshOptions.host === '127.0.0.1';
}

function shouldRoleRun(ctx: BaseContext, roleName: string) {
    return !ctx.rolesToRun || ctx.rolesToRun.indexOf(roleName) >= 0;
}
