import * as commandLineArgs from "command-line-args";
import * as commandLineUsage from "command-line-usage";

export interface CommandLineOption {
    name: string;
    alias?: string;
    key?: string;
    type?: (value: any) => any;
    multiple?: boolean;
    defaultOption?: boolean;
    defaultValue?: any;
    group?: string | string[];
    typeLabel?: string;
    description?: string;
}

export interface CommandLineArgs {
    argv: string[];
    partial?: boolean;
    help?: any;
}

export function commandLineParse(options: CommandLineOption[], args: CommandLineArgs): any {
    try {
        if (args.help && !options.some(o => o.name === 'help')) {
            options.push({name: 'help', alias: 'h', type: Boolean, description: 'Help'});
        }
        const results = commandLineArgs(options, args);
        if (results.help && args.help) {
            for (let section of args.help) {
                if (section.options === true) {
                    section.header = 'Options';
                    section.optionList = options;
                }
            }
            console.error(commandLineUsage(args.help));
            process.exit(-1);
            return;
        }
        return results;
    } catch (err) {
        console.error(err.message);
        process.exit(-1);
        return;
    }
}