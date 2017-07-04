import {BaseContext, FileRef, PLUGIN_TYPES, Script, ScriptRef, StampyLine} from "../types";
import * as _ from "lodash";
import * as fs from "fs-extra";
import * as path from "path";
import * as mapSeries from "promise-map-series";

export type LoadedScripts = { [fullPath: string]: Script };

export function loadScripts(ctx: BaseContext, scriptRefs: ScriptRef[], loadedScripts?: LoadedScripts): Promise<Script[]> {
    loadedScripts = loadedScripts || {};
    return mapSeries(
        scriptRefs,
        scriptRef => {
            return expandScripts(ctx, scriptRef, loadedScripts);
        }
    ).then(scripts => {
        return _.flatten(scripts);
    });
}

async function expandScripts(ctx: BaseContext, scriptRef: ScriptRef, loadedScripts: LoadedScripts): Promise<Script[]> {
    const requirePlugin = ctx.plugins.require[scriptRef.requirePluginName];
    if (!requirePlugin) {
        throw new Error(`Could not find require plugin "${scriptRef.requirePluginName}"`);
    }
    const results = await requirePlugin.expandRequires(ctx, scriptRef.args);
    scriptRef.scripts = results.scripts || [];
    scriptRef.files = results.files || [];
    return loadScriptFiles(ctx, scriptRef, results.scripts, loadedScripts);
}

function loadScriptFiles(ctx: BaseContext, sourceScriptRef: ScriptRef, files: FileRef[], loadedScripts: LoadedScripts): Promise<Script[]> {
    return mapSeries(
        files || [],
        f => loadScriptFile(ctx, sourceScriptRef, f, loadedScripts)
    ).then(scripts => {
        return _.compact(_.flatten(scripts));
    });
}

async function loadScriptFile(ctx: BaseContext, sourceScriptRef: ScriptRef, file: FileRef, loadedScripts: LoadedScripts): Promise<Script> {
    if (loadedScripts[file.packagePath]) {
        return loadedScripts[file.packagePath];
    }
    const fileContents = await fs.readFile(file.fullPath, 'utf8');
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
    loadedScripts[file.packagePath] = script;
    const subCtx = {
        ...ctx,
        cwd: path.dirname(file.fullPath)
    };
    script.requires = await loadScripts(subCtx, requires, loadedScripts);
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
            const m = line.match(`^# (${PLUGIN_TYPES.join('|')}) (.*)`);
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
