import {BaseContext, CommandPlugin, ExecutionContext, FileRef, RunPlugin, Script, ScriptRef} from "../../../types";
import * as executor from "../../executor";
import * as _ from "lodash";
import {loadScripts} from "../../script-loader";
import {copyFile, executeCommand, reboot} from "../../utils/remote";
import * as path from "path";
import * as rjson from "relaxed-json";

export class DefaultCommandPlugin implements CommandPlugin {
    run(ctx: BaseContext, args: string[]): Promise<void> {
        return DefaultCommandPlugin.runStatic(ctx, args);
    }

    public static async runStatic(ctx: BaseContext, args: string[]): Promise<void> {
        const initialScripts = DefaultCommandPlugin.findInitialScripts(ctx, args);
        ctx.scripts = await loadScripts(ctx, initialScripts);
        DefaultCommandPlugin.validateScripts(ctx.scripts);
        await executor.execute(ctx);
    }

    preExecution(ctx: BaseContext): Promise<boolean> {
        return Promise.resolve(ctx.scripts.length > 0);
    }

    public async execute(ctx: ExecutionContext): Promise<void> {
        for (let script of ctx.scripts) {
            if (await DefaultCommandPlugin.shouldExecuteScript(ctx, script)) {
                await DefaultCommandPlugin.executeScript(ctx, script);
                await DefaultCommandPlugin.executeScriptCompleteFunctions(ctx, script);
            } else {
                ctx.logWithScript(script, 'SKIP');
            }
        }
    }

    static async shouldExecuteScript(ctx: ExecutionContext, script: Script): Promise<boolean> {
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

    private static executeScript(ctx: ExecutionContext, script: Script): Promise<void> {
        ctx.logWithScript(script, 'RUN');
        if (ctx.dryRun) {
            return Promise.resolve();
        }

        return DefaultCommandPlugin.executeRunLines(ctx, script)
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
                                        ctx.logWithScript(script, 'SKIP');
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
                            ctx.logWithScript(script, 'STDOUT', line);
                        }
                    });
                    ee.on('stderr', data => {
                        ctx.logWithScript(script, 'STDERR', data);
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

    private static async executeRunLines(ctx: ExecutionContext, script: Script): Promise<FileRef[]> {
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

    private static async executeScriptCompleteFunctions(ctx: ExecutionContext, script: Script): Promise<void> {
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

    private static validateScripts(scripts: Script[]) {
        for (let script of scripts) {
            DefaultCommandPlugin.validateScriptCircularDependencies([script]);
            if (script.requires) {
                DefaultCommandPlugin.validateScripts(script.requires);
            }
        }
    }

    private static validateScriptCircularDependencies(scriptPath: Script[]) {
        for (let child of scriptPath[scriptPath.length - 1].requires) {
            for (let s of scriptPath) {
                if (s === child) {
                    throw new Error(`Circular dependency detected from script "${s.path.packagePath}"`);
                }
            }
            DefaultCommandPlugin.validateScriptCircularDependencies(scriptPath.concat([child]));
        }
    }

    private static findInitialScripts(ctx: BaseContext, args: string[]): ScriptRef[] {
        const argScripts: ScriptRef[] = args.map(arg => {
            return {
                basePath: ctx.cwd,
                requirePluginName: 'script',
                args: [arg]
            };
        });

        const commandScripts: ScriptRef[] = ctx.command.scripts.map(script => {
            return {
                basePath: ctx.cwd,
                requirePluginName: 'script',
                args: [script]
            }
        });

        const includes: ScriptRef[] = (ctx.config.includes || []).map(include => {
            return {
                basePath: ctx.cwd,
                requirePluginName: 'file',
                args: [include]
            };
        });

        return _.flatten(argScripts).concat(commandScripts).concat(includes);
    }
}
