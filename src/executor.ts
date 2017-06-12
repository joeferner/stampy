import {BaseContext, ExecutionContext, Script} from "../types";
import * as _ from "lodash";
import * as child_process from "child_process";
import * as ssh2 from "ssh2";
import * as scp2 from "scp2";
import * as path from "path";
import {calculateExecutionOrder} from "./execution-order";
import * as EventEmitter from "events";
import * as rjson from "relaxed-json";
import * as chalk from "chalk";
import {log} from "./log";

const ScpClient = scp2.Client;
const exec = child_process.exec;

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
                await syncFiles(ctx);
            }
            await executeScripts(ctx);
            if (ctx.client) {
                ctx.client.end();
            }
        } finally {
            colorFnQueue.push(ctx.logColorHostFn);
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
                    roles: [roleName],
                    exec: null,
                    log: null,
                    logColorHostFn: null
                };
            }
        }
    }
    let executionContexts = _.values(results);
    for (let ctx of executionContexts) {
        ctx.local = isLocal(ctx);
        ctx.scripts = await calculateExecutionOrder(ctx, ctx.scripts);
        ctx.exec = executeCommand.bind(null, ctx);
        ctx.log = log.bind(null, ctx);
    }
    return executionContexts;
}

function syncFiles(ctx: ExecutionContext): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const client = new ScpClient(ctx.sshOptions);
        client.on('error', err => {
            reject(err);
        });
        syncFilesToClient(ctx, client, ctx.scripts)
            .then(() => {
                client.close();
                resolve();
            })
            .catch((err) => {
                reject(err);
            });

        async function syncFilesToClient(ctx: ExecutionContext, client: scp2.Client, scripts: Script[]): Promise<void> {
            for (let script of scripts) {
                await syncFile(ctx, client, script);
            }
        }

        async function syncFile(ctx: ExecutionContext, client: scp2.Client, script: Script): Promise<void> {
            let localFile = path.resolve(script.sourceScriptRef.basePath, script.path);
            script.remoteFile = path.join('.stampy/working', script.path);
            await copyFile(client, script, localFile, script.remoteFile);
            for (let file of script.files) {
                const scriptPath = path.dirname(script.path);
                localFile = path.resolve(script.sourceScriptRef.basePath, scriptPath, file);
                const remoteFile = path.join('.stampy/working', scriptPath, file);
                log(ctx, script, 'COPY', file);
                await copyFile(client, script, localFile, remoteFile);
            }
        }

        async function copyFile(client: scp2.Client, script: Script, localFile: string, remoteFile: string) {
            log(ctx, script, 'COPY', `${path.relative(ctx.cwd, localFile)} -> ${remoteFile}`);
            return new Promise<void>((resolve, reject) => {
                return client.upload(localFile, remoteFile, err => {
                    if (err) {
                        return reject(err);
                    }
                    return resolve();
                });
            });
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
        if (line.type === 'run-if') {
            const runIfPluginName = line.args[0];
            const runIfPlugin = ctx.plugins['run-if'][runIfPluginName];
            if (!runIfPlugin) {
                throw new Error(`Could not find 'run-if' plugin '${runIfPluginName}'`);
            }
            if (runIfPlugin.shouldExecute) {
                const result = await runIfPlugin.shouldExecute(ctx, script, line.args.slice(1));
                if (!result) {
                    return false;
                }
            }
        }
    }
    return true;
}

async function executeScriptCompleteFunctions(ctx: ExecutionContext, script: Script): Promise<void> {
    for (let line of script.stampyLines) {
        if (line.type === 'run-if') {
            const pluginName = line.args[0];
            const plugin = ctx.plugins[line.type][pluginName];
            if (!plugin) {
                throw new Error(`Could not find '${line.type}' plugin '${pluginName}'`);
            }
            if (plugin.scriptComplete) {
                await plugin.scriptComplete(ctx, script, line.args.slice(1));
            }
        }
    }
}

function getSshClient(ctx: ExecutionContext): Promise<ssh2.Client> {
    return new Promise<ssh2.Client>((resolve, reject) => {
        const client = new ssh2.Client();
        client.on('ready', () => {
            resolve(client);
        });
        client.on('error', err => {
            reject(err);
        });
        log(ctx, null, 'CONNECT', `username: ${ctx.sshOptions.username || '<no username specified>'}`);
        client.connect(ctx.sshOptions);
    });
}

function executeCommand(ctx: ExecutionContext, script: Script, command: string): EventEmitter {
    if (ctx.local) {
        return executeCommandLocal(ctx, script, command);
    } else {
        return executeCommandRemote(ctx, script, command);
    }
}

function executeCommandLocal(ctx: ExecutionContext, script: Script, command: string): EventEmitter {
    const options = {
        cwd: script.sourceScriptRef.basePath, // TODO copy all scripts to a single directory
        env: {
            ROLES: ctx.roles.join(' ')
        }
    };
    const result = new EventEmitter();
    const cp = exec(command, options);
    cp.stdout.on('data', data => {
        result.emit('stdout', data);
    });
    cp.stderr.on('data', data => {
        result.emit('stderr', data);
    });
    cp.on('close', (code) => {
        result.emit('close', code);
    });
    return result;
}

function executeCommandRemote(ctx: ExecutionContext, script: Script, command: string): EventEmitter {
    const result = new EventEmitter();
    const remotePath = path.dirname(script.remoteFile);
    command = `cd "${remotePath}" && ROLES="${ctx.roles.join(' ')}" ${command}`;
    ctx.client.exec(command, (err, stream) => {
        if (err) {
            return result.emit('error', err);
        }
        stream.on('close', (code, signal) => {
            result.emit('close', code, signal);
        });
        stream.on('data', data => {
            result.emit('stdout', data);
        });
        stream.stderr.on('data', data => {
            result.emit('stderr', data);
        });
    });
    return result;
}

function executeScript(ctx: ExecutionContext, script: Script): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        log(ctx, script, 'RUN');
        const ee = executeCommand(ctx, script, script.path);
        ee.on('stdout', data => {
            let m;
            if (m = (data + '').match(/^STAMPY:(.*)/)) {
                const exprStr = m[1].trim();
                const expr = JSON.parse(rjson.transform(exprStr));
                switch (expr.action) {
                    case 'SKIP':
                        log(ctx, script, 'SKIP');
                        return resolve();
                    default:
                        return reject(new Error(`Invalid action received from script "${expr.action}"`));
                }
            }
            log(ctx, script, 'STDOUT', data);
        });
        ee.on('stderr', data => {
            log(ctx, script, 'STDERR', data);
        });
        ee.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`process exited with code ${code}`));
            }
        });
    });
}

function isLocal(ctx: ExecutionContext) {
    return ctx.sshOptions.host === 'localhost' || ctx.sshOptions.host === '127.0.0.1';
}

function shouldRoleRun(ctx: BaseContext, roleName: string) {
    return !ctx.rolesToRun || ctx.rolesToRun.indexOf(roleName) >= 0;
}
