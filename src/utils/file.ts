import * as path from "path";

export function relative(from: string, to: string): string {
    let result = path.relative(from, to);
    if (!result.startsWith('.') && !result.startsWith('/')) {
        result = './' + result;
    }
    return result;
}