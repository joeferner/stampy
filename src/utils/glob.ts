import {BaseContext, FileRef} from "../../types";
import * as path from "path";
import * as _ from "lodash";
import * as glob from "glob";
import {relative} from "./file";

export function globFiles(ctx: BaseContext, args: string[]): Promise<FileRef[]> {
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
        return _.flatten(files).map(f => {
            const fullPath = path.join(ctx.cwd, f);
            return {
                fullPath: fullPath,
                packagePath: relative(ctx.baseDir, fullPath)
            };
        });
    });
}
