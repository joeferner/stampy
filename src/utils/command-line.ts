import * as commandLineArgs from "command-line-args";

export interface CommandLineOption {
    name: string,
    alias?: string,
    key?: string,
    type?: (value: any) => any,
    multiple?: boolean,
    defaultOption?: boolean,
    defaultValue?: any,
    group?: string | string[]
}

export interface CommandLineArgs {
    argv: string[],
    partial?: boolean
}

export function commandLineParse(options: CommandLineOption[], args: CommandLineArgs): any {
    try {
        return commandLineArgs(options, args);
    } catch (err) {
        console.error(err.message);
        process.exit(-1);
        return;
    }
}