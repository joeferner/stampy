import {ExecutionContext, FileRef, RunPlugin, RunResults, Script} from "../../../types";
import * as ejs from "ejs";
import * as fs from "fs-extra";
import * as path from "path";
import * as NestedError from "nested-error-stacks";
import * as tmp from "tmp";
import {relative} from "../../utils/file";

export class EjsRunPlugin implements RunPlugin {
    public async run?(ctx: ExecutionContext, script: Script, args: string[]): Promise<RunResults> {
        if (args.length !== 1 && args.length !== 2) {
            throw new Error(`ejs requires 1 or 2 arguments found ${args.length}`);
        }
        const src = EjsRunPlugin.getSourceFileName(ctx, script, args[0]);
        const dest = await EjsRunPlugin.getDestFileName(ctx, script, args, src);
        const template = await EjsRunPlugin.compileTemplate(ctx, src);
        const results = EjsRunPlugin.executeTemplate(ctx, template, src);
        await fs.writeFile(dest.fullPath, results, {encoding: 'utf8'});
        return {
            files: [dest]
        };
    }

    private static async getDestFileName(ctx: ExecutionContext, script: Script, args: string[], src: FileRef): Promise<FileRef> {
        const packagePath = args.length === 1
            ? EjsRunPlugin.removeEjsExtension(src.packagePath)
            : EjsRunPlugin.getSourceFileName(ctx, script, args[1]).packagePath;
        return new Promise<FileRef>((resolve, reject) => {
            tmp.tmpName(function _tempNameGenerated(err, path) {
                if (err) {
                    return reject(err);
                }
                return resolve({
                    fullPath: path,
                    packagePath
                });
            });
        });
    }

    private static getSourceFileName(ctx: ExecutionContext, script: Script, arg: string): FileRef {
        const fullPath = path.join(path.dirname(script.path.fullPath), arg);
        return {
            fullPath: fullPath,
            packagePath: relative(ctx.baseDir, fullPath)
        };
    }

    private static async compileTemplate(ctx: ExecutionContext, src: FileRef): Promise<ejs.TemplateFunction> {
        try {
            const srcContent = await fs.readFile(src.fullPath, 'utf8');
            return ejs.compile(srcContent, {
                context: ctx
            });
        } catch (err) {
            throw new NestedError(`Could not compile ejs ${src.packagePath}`, err);
        }
    }

    private static executeTemplate(ctx: ExecutionContext, template: ejs.TemplateFunction, src: FileRef): string {
        try {
            return template({
                ctx
            });
        } catch (err) {
            throw new NestedError(`Could not run ejs ${src.packagePath}`, err);
        }
    }

    private static removeEjsExtension(file: string): string {
        if (file.endsWith('.ejs')) {
            return file.substring(0, file.length - '.ejs'.length);
        }
        throw new Error('When calling ejs with 1 argument the file must end in ".ejs"');
    }
}
