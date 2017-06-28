import {ExpandRequiresResults, RequirePlugin, RequirePluginContext} from "../../../types";
import {globFiles} from "../../utils/glob";

export class FilesRequirePlugin implements RequirePlugin {
    async expandRequires(ctx: RequirePluginContext, args: string[]): Promise<ExpandRequiresResults> {
        const files = await globFiles(ctx, args);
        return {files: files};
    }
}
