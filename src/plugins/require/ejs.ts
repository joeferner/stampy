import {ExecutionContext, ExpandRequiresResults, RequirePlugin, RequirePluginContext, Script} from "../../../types";
import * as ejs from "ejs";
import * as fs from "fs-extra";
import * as path from "path";
import * as NestedError from "nested-error-stacks";

export class EjsRequirePlugin implements RequirePlugin {
    public async expandRequires(ctx: RequirePluginContext, args: string[]): Promise<ExpandRequiresResults> {
        if (args.length !== 1 && args.length !== 2) {
            throw new Error(`ejs requires 1 or 2 arguments found ${args.length}`);
        }
        const src = EjsRequirePlugin.getSourceFileName(ctx, args);
        const dest = EjsRequirePlugin.getDestFileName(args, src, ctx);
        const template = await EjsRequirePlugin.compileTemplate(ctx, src);
        const results = EjsRequirePlugin.executeTemplate(ctx, template, src);
        await fs.writeFile(dest, results, 'utf8');
        return {
            files: [dest]
        };
    }

    private static getDestFileName(args: string[], src: string, ctx: RequirePluginContext) {
        return args.length === 1 ? EjsRequirePlugin.removeEjsExtension(src) : path.join(ctx.cwd, args[1]);
    }

    private static getSourceFileName(ctx: RequirePluginContext, args: string[]) {
        return path.join(ctx.cwd, args[0]);
    }

    private static async compileTemplate(ctx: RequirePluginContext, src: string): Promise<ejs.TemplateFunction> {
        try {
            const srcContent = await fs.readFile(src, 'utf8');
            return ejs.compile(srcContent, {
                context: ctx
            });
        } catch (err) {
            throw new NestedError(`Could not compile ejs ${src}`, err);
        }
    }

    private static executeTemplate(ctx: RequirePluginContext, template: ejs.TemplateFunction, src: string): string {
        try {
            return template({
                ctx
            });
        } catch (err) {
            throw new NestedError(`Could not run ejs ${src}`, err);
        }
    }

    private static removeEjsExtension(file: string): string {
        if (file.endsWith('.ejs')) {
            return file.substring(0, file.length - '.ejs'.length);
        }
        throw new Error('When calling ejs with 1 argument the file must end in ".ejs"');
    }
}
