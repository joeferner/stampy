import EventEmitter = NodeJS.EventEmitter;

export const PLUGIN_TYPES = [
    'require',
    'run-if',
    'run-if!',
    'skip-if',
    'skip-if!',
    'run'
];

export interface FileRef {
    fullPath: string;
    packagePath: string;
}

export interface Command {
    description?: string;
    scripts: string[]
}

export interface Host {
    description?: string;
    hosts: string[]
}

export interface SshConfig {
    host?: string;
    username?: string;
    password?: string;
    readyTimeout?: number;
    privateKey?: string;
    sshCommand?: string;
    scpCommand?: string;
}

export interface HostOptions {
    ssh: SshConfig;
    rebootCommand: string;
    sudo: boolean;
    compareMd5sOnCopy: boolean;
    workingPath: string;
}

export interface Config {
    defaults: HostOptions;
    plugins?: {
        require: { [name: string]: string };
        'run-if': { [name: string]: string };
        run: { [name: string]: string };
    };
    commands: { [command: string]: Command };
    hosts?: { host: string, roles: string[] }[];
    roles: { [role: string]: Host };
    groups?: { [name: string]: Config };
    includes: string[];
    data: { [name: string]: any };
}

export interface CommandLineArguments {
    config: string[];
    args: string[];
}

export interface Plugins {
    require: { [key: string]: RequirePlugin };
    'run-if': { [key: string]: RunIfPlugin };
    run: { [key: string]: RunPlugin };
}

export interface ScriptRef {
    basePath: string;
    requirePluginName: string;
    args: string[];
    scripts?: FileRef[];
    files?: FileRef[];
}

export interface StampyLine {
    type: string;
    args: string[];
}

export interface Script {
    sourceScriptRef: ScriptRef;
    path: FileRef;
    requires: Script[];
    files: FileRef[];
    stampyLines: StampyLine[];
}

export type OutputFormat = 'normal' | 'json';

export type LogAction = 'RUN' | 'STDERR' | 'STDOUT' | 'SKIP' | 'COPY' | 'CONNECT' | 'CLOSE' | 'DONE';

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

export interface SshClient {
    end: () => Promise<void>;
    exec: (cmd: string) => Promise<EventEmitter>;
    run: (script: Script, cmd: string) => Promise<number>;
}

export interface ExecutionContext extends BaseContext {
    local: boolean;
    sshOptions: SshConfig;
    sshClient?: SshClient;
    roles: string[];
    scripts: Script[];
    logColorHostFn: (msg: string) => string;
    options: HostOptions;

    exec: (script: Script, command: string) => EventEmitter;
    copyFile: (script: Script, file: FileRef) => Promise<void>;
    log: (script: Script, action: LogAction, data?) => void;
}

export interface Plugin {
    /**
     * Called after the script completed execution
     */
    scriptComplete?(ctx: ExecutionContext, script: Script, args: string[], code: number): Promise<void>;
}

export interface ExpandRequiresResults {
    scripts?: FileRef[];
    files?: FileRef[];
}

export interface RequirePlugin extends Plugin {
    expandRequires(ctx: RequirePluginContext, args: string[]): Promise<ExpandRequiresResults>;
}

export interface RunIfPlugin extends Plugin {
    shouldExecute?(ctx: ExecutionContext, script: Script, args: string[]): Promise<boolean>;
}

export interface RunResults {
    files?: FileRef[];
}

export interface RunPlugin extends Plugin {
    run?(ctx: ExecutionContext, script: Script, args: string[]): Promise<RunResults>;
}
