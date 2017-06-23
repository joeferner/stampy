import * as ssh2 from "ssh2";
import EventEmitter = NodeJS.EventEmitter;

export interface Command {
    description?: string;
    scripts: string[]
}

export interface Host {
    description?: string;
    hosts: string[]
}

export interface Config {
    sudo?: boolean;
    defaults: {
        ssh: ssh2.ConnectConfig;
    };
    plugins?: {
        require: { [name: string]: string };
        'run-if': { [name: string]: string };
    };
    commands: { [command: string]: Command };
    hosts?: { host: string, roles: string[] }[];
    roles: { [role: string]: Host };
    groups?: { [name: string]: Config };
    includes: string[];
}

export interface CommandLineArguments {
    config: string[];
    args: string[];
}

export interface Plugins {
    require: { [key: string]: RequirePlugin };
    'run-if': { [key: string]: RunIfPlugin };
}

export interface ScriptRef {
    basePath: string;
    requirePluginName: string;
    args: string[];
    scripts?: string[];
    files?: string[];
}

export interface StampyLine {
    type: string;
    args: string[];
}

export interface Script {
    sourceScriptRef: ScriptRef;
    path: string;
    remoteFile?: string;
    requires: Script[];
    files: string[];
    stampyLines: StampyLine[];
}

export type OutputFormat = 'normal' | 'json';

export type LogAction = 'RUN' | 'STDERR' | 'STDOUT' | 'SKIP' | 'COPY' | 'CONNECT' | 'DONE';

export interface BaseContext {
    baseDir: string;
    cwd: string;
    configFile: string;
    commandLineArgs: CommandLineArguments;
    config: Config;
    plugins: Plugins;
    scripts: Script[];
    rolesToRun?: string[];
    groups: string[];
    outputFormat: OutputFormat;
    outputFileFD?: number;
    dryRun: boolean;
    includes: string[];
    pluginData: { [name: string]: any };
}

export interface RequirePluginContext extends BaseContext {
    log: (action: LogAction, data?) => void;
}

export interface ExecutionContext extends BaseContext {
    local: boolean;
    sshOptions: ssh2.ConnectConfig;
    client?: ssh2.Client;
    roles: string[];
    scripts: Script[];
    logColorHostFn: (msg: string) => string;

    exec: (script: Script, command: string) => EventEmitter;
    log: (script: Script, action: LogAction, data?) => void;
}

export interface Plugin {
    /**
     * Called after the script completed execution
     */
    scriptComplete?(ctx: ExecutionContext, script: Script, args: string[], code: number): Promise<void>;
}

export interface ExpandRequiresResults {
    scripts?: string[];
    files?: string[];
}

export interface RequirePlugin extends Plugin {
    expandRequires(ctx: RequirePluginContext, args: string[]): Promise<ExpandRequiresResults>;
}

export interface RunIfPlugin extends Plugin {
    /**
     * Called before the requires are expanded and executed. Returning false will prevent the
     * follow script require tree to be skipped
     */
    preRunShouldExecute?(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean>;

    /**
     * Determines if the given script should be executed. Even if this function returns false
     * the required scripts will be executed
     */
    shouldExecute?(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean>;
}
