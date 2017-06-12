import {RequirePluginContext, Script, ScriptRef, StampyLine} from "../types";
import * as _ from "lodash";
import * as fs from "fs-extra";
import * as path from "path";

export type LoadedScripts = { [fullPath: string]: Script };

export async function loadScripts(ctx: RequirePluginContext, scriptRefs: ScriptRef[], loadedScripts?: LoadedScripts): Promise<Script[]> {
    loadedScripts = loadedScripts || {};
    const scripts = await Promise.all(
        scriptRefs.map(scriptRef => {
            return expandScripts(ctx, scriptRef, loadedScripts);
        })
    );
    return _.flatten(scripts);
}

async function expandScripts(ctx: RequirePluginContext, scriptRef: ScriptRef, loadedScripts: LoadedScripts): Promise<Script[]> {
    const requirePlugin = ctx.plugins.require[scriptRef.requirePluginName];
    if (!requirePlugin) {
        throw new Error(`Could not find require plugin "${scriptRef.requirePluginName}"`);
    }
    const results = await requirePlugin.expandRequires(ctx, scriptRef.args);
    scriptRef.scripts = results.scripts;
    scriptRef.files = results.files;
    return loadScriptFiles(ctx, scriptRef, results.scripts, loadedScripts);
}

async function loadScriptFiles(ctx: RequirePluginContext, sourceScriptRef: ScriptRef, files: string[], loadedScripts: LoadedScripts): Promise<Script[]> {
    const scripts = await Promise.all((files || []).map(f => loadScriptFile(ctx, sourceScriptRef, f, loadedScripts)));
    return _.compact(_.flatten(scripts));
}

async function loadScriptFile(ctx: RequirePluginContext, sourceScriptRef: ScriptRef, file: string, loadedScripts: LoadedScripts): Promise<Script> {
    const fullPath = path.resolve(sourceScriptRef.basePath, file);
    if (loadedScripts[fullPath]) {
        return loadedScripts[fullPath];
    }
    const fileContents = await fs.readFile(fullPath, 'utf8');
    const stampyLines = getStampyLines(fileContents);
    const requires: ScriptRef[] = stampyLines
        .filter(sl => sl.type === 'require')
        .map(sl => {
            return {
                basePath: sourceScriptRef.basePath,
                requirePluginName: sl.args[0],
                args: sl.args.slice(1)
            };
        });
    const script: Script = {
        sourceScriptRef: sourceScriptRef,
        path: file,
        requires: [],
        stampyLines: stampyLines,
        files: []
    };
    loadedScripts[fullPath] = script;
    script.requires = await loadScripts(ctx, requires, loadedScripts);
    for (let require of requires) {
        if (require.files) {
            script.files = script.files.concat(require.files);
        }
    }
    return script;
}

function splitArgs(argString: string): string[] {
    // TODO better arg split
    return argString.split(' ');
}

function getStampyLines(fileContents: string): StampyLine[] {
    const lines = fileContents.split('\n');
    return lines
        .map(line => {
            const m = line.match(/# (require|run-if) (.*)/);
            if (!m) {
                return null;
            }
            return {
                type: m[1],
                args: splitArgs(m[2])
            };
        })
        .filter(line => !!line);
}
