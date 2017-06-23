import {ExpandRequiresResults, RequirePluginContext, RequirePlugin} from "../../../types";
import * as ejs from "ejs";
import * as fs from 'fs-extra';
import * as path from "path";
import * as NestedError from "nested-error-stacks";

export class EjsRequirePlugin implements RequirePlugin {
    async expandRequires(ctx: RequirePluginContext, args: string[]): Promise<ExpandRequiresResults> {
        if (args.length !== 1 && args.length !== 2) {
            throw new Error(`ejs requires 1 or 2 arguments found ${args.length}`);
        }
        const src = args[0];
        const dest = args.length === 1 ? EjsRequirePlugin.removeEjsExtension(src) : args[1];
        const srcContent = await fs.readFile(path.join(ctx.cwd, src), 'utf8');
        const template = EjsRequirePlugin.compileTemplate(srcContent, src);
        const results = EjsRequirePlugin.executeTemplate(ctx, template, src);
        await fs.writeFile(path.join(ctx.cwd, dest), results, 'utf8');
        return {
            files: [dest]
        };
    }

    private static compileTemplate(srcContent: string, src: string): ejs.TemplateFunction {
        try {
            return ejs.compile(srcContent);
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
