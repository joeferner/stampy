import * as glob from "glob";
import {ExpandRequiresResults, RequirePlugin, RequirePluginContext} from "../../../types";
import * as _ from "lodash";

export abstract class FileGlobRequirePlugin implements RequirePlugin {
    abstract expandRequires(ctx: RequirePluginContext, args: string[]): Promise<ExpandRequiresResults>;

    protected globFiles(ctx: RequirePluginContext, args: string[]): Promise<string[]> {
        const globOptions = {
            cwd: ctx.cwd,
            nodir: true
        };

        return <Promise<string[]>>Promise.all(
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
        ).then(files => {
            files.forEach((file: string[], i) => {
                if (file.length === 0) {
                    throw new Error(`Could not find scripts with pattern ${args[i]} (cwd: ${globOptions.cwd})`);
                }
            });
            return _.flatten(files);
        });
    }
}
