import {ExecutionContext, Script} from "../types";

export async function calculateExecutionOrder(ctx: ExecutionContext, scripts: Script[]): Promise<Script[]> {
    const results: Script[] = [];
    await calculateExecutionOrderRecursive(ctx, scripts, results);
    return results;
}

async function calculateExecutionOrderRecursive(ctx: ExecutionContext, scripts: Script[], results: Script[]): Promise<void> {
    for (let script of scripts) {
        if (isScriptInResults(results, script)) {
            continue;
        }
        const run = await shouldRun(ctx, script);
        if (run) {
            await calculateExecutionOrderRecursive(ctx, script.requires, results);
            results.push(script);
        }
    }
}

function isScriptInResults(results: Script[], script: Script): boolean {
    for (let result of results) {
        if (script.path === result.path) {
            return true;
        }
    }
    return false;
}

async function shouldRun(ctx: ExecutionContext, script: Script): Promise<boolean> {
    for (let line of script.stampyLines) {
        if (line.type === 'run-if' || line.type === 'skip-if') {
            const runIfPluginName = line.args[0];
            const runIfPlugin = ctx.plugins['run-if'][runIfPluginName];
            if (!runIfPlugin) {
                throw new Error(`Could not find 'run-if' plugin '${runIfPluginName}'`);
            }
            if (runIfPlugin.preRunShouldExecute) {
                let result = await runIfPlugin.preRunShouldExecute(ctx, script, line.args.slice(1));
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
