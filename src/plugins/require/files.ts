import {ExpandRequiresResults, RequirePluginContext} from "../../../types";
import {FileGlobRequirePlugin} from "./file-glob";

export class FilesRequirePlugin extends FileGlobRequirePlugin {
    async expandRequires(ctx: RequirePluginContext, args: string[]): Promise<ExpandRequiresResults> {
        const files = await super.globFiles(ctx, args);
        return {files: files};
    }
}
