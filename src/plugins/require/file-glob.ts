import * as glob from "glob";
import {ExpandRequiresResults, RequirePlugin, RequirePluginContext} from "../../../types";
import * as _ from "lodash";
import * as path from "path";

export abstract class FileGlobRequirePlugin implements RequirePlugin {
    abstract expandRequires(ctx: RequirePluginContext, args: string[]): Promise<ExpandRequiresResults>;

    protected globFiles(ctx: RequirePluginContext, args: string[]): Promise<string[]> {
        const globOptions = {
            cwd: ctx.cwd,
            nodir: true
        };

        return Promise.all<string[]>(
            args.map(arg => {
                return new Promise((resolve, reject) => {
                    glob(arg, globOptions, (err, files) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve(files);
                    });
                })
            })
        ).then((files: string[][]) => {
            files.forEach((file: string[], i) => {
                if (file.length === 0) {
                    throw new Error(`Could not find files with pattern ${args[i]} (cwd: ${globOptions.cwd})`);
                }
            });
            return _.flatten(files).map(f => path.join(ctx.cwd, f));
        });
    }
}
