import {BaseContext, ExpandRequiresResults, RequirePlugin} from "../../../types";
import * as path from "path";
import * as glob from "glob";
import {relative} from "../../utils/file";

export class ExternalFileRequirePlugin implements RequirePlugin {
    async expandRequires(ctx: BaseContext, args: string[]): Promise<ExpandRequiresResults> {
        if (args.length !== 2) {
            throw new Error(`"external-file" expected 2 arguments, found ${args.length}`);
        }
        const from = args[0];
        const to = args[1];

        const fromFiles = await ExternalFileRequirePlugin.getFromFiles(ctx, from);
        if (fromFiles.length === 0) {
            throw new Error(`could not find file with pattern "${from}"`);
        }
        if (fromFiles.length > 1) {
            throw new Error(`found too many files with pattern "${from}"`);
        }

        const fullPath = path.resolve(ctx.cwd, fromFiles[0]);
        const packagePath = relative(ctx.baseDir, path.join(ctx.cwd, to));
        return {
            files: [{
                fullPath,
                packagePath
            }]
        };
    }

    private static getFromFiles(ctx: BaseContext, pattern: string): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const globOptions = {
                cwd: ctx.cwd,
                nodir: true
            };
            glob(pattern, globOptions, (err, files) => {
                if (err) {
                    return reject(err);
                }
                resolve(files);
            });
        });
    }
}