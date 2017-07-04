import {BaseContext, CommandPlugin, Script, ScriptRef} from "../../../types";
import {execute} from "../../executor";
import * as _ from "lodash";
import {loadScripts} from "../../script-loader";

export class DefaultCommandPlugin implements CommandPlugin {
    run(ctx: BaseContext, args: string[]): Promise<void> {
        return DefaultCommandPlugin.runStatic(ctx, args);
    }

    public static async runStatic(ctx: BaseContext, args: string[]): Promise<void> {
        const initialScripts = DefaultCommandPlugin.findInitialScripts(ctx, args);
        ctx.scripts = await loadScripts(ctx, initialScripts);
        DefaultCommandPlugin.validateScripts(ctx.scripts);
        await execute(ctx);
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