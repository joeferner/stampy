import EventEmitter = NodeJS.EventEmitter;

export const PLUGIN_TYPES = [
    'context',
    'require',
    'run-if',
    'run-if!',
    'skip-if',
    'skip-if!',
    'run',
    'lifecycle'
];

export interface FileRef {
    fullPath: string;
    packagePath: string;
}

export interface Command {
    description?: string;
    scripts: string[];
    commandPlugin?: string | CommandPlugin;
}

export interface Host {
    description?: string;
    hosts: string[]
}

export interface SshConfig {
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
    env: { [name: string]: string };
}

export interface Config {
    defaults: HostOptions;
    plugins?: {
        context: { [name: string]: string };
        require: { [name: string]: string };
        'run-if': { [name: string]: string };
        run: { [name: string]: string };
        command: { [name: string]: string };
        lifecycle: { [name: string]: string };
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
    role?: string[];
    host?: string[];
    output?: string;
    group: string[];
    'dry-run': boolean;
    'output-format': string;
    args: string[];
    commandArgs?: string[];
}

export interface Plugins {
    context: { [key: string]: ContextPlugin };
    require: { [key: string]: RequirePlugin };
    'run-if': { [key: string]: RunIfPlugin };
    run: { [key: string]: RunPlugin };
    command: { [key: string]: CommandPlugin };
    lifecycle: { [key: string]: LifecyclePlugin };
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
    hostsToRun?: string[];
    groups: string[];
    outputFormat: OutputFormat;
    outputFileFD?: number;
    dryRun: boolean;
    includes: string[];
    command: Command;
    pluginData: { [name: string]: any };
    log: (action: LogAction, data?) => void;
}

export interface SshClient {
    end: () => Promise<void>;
    exec: (cmd: string) => Promise<EventEmitter>;
    run: (script: Script, cmd: string) => Promise<number>;
}

export enum ExecutionContextState {
    INITIALIZING,
    CONNECTED,
    FILES_SYNCED,
    DISCONNECTED
}

export interface ExecutionContext extends BaseContext {
    state: ExecutionContextState;
    local: boolean;
    host?: string;
    sshOptions: SshConfig;
    sshClient?: SshClient;
    roles: string[];
    scripts: Script[];
    logColorHostFn: (msg: string) => string;
    options: HostOptions;

    exec: (script: Script, command: string) => EventEmitter;
    run: (script: Script, command: string) => Promise<number>;
    copyFile: (script: Script, file: FileRef) => Promise<void>;
    logWithScript: (script: Script, action: LogAction, data?) => void;
}

export interface Plugin {
    description?: string;

    /**
     * Called after the script completed execution
     */
    scriptComplete?(ctx: ExecutionContext, script: Script, args: string[], code: number): Promise<void>;
}

export interface CommandPlugin extends Plugin {
    run?(ctx: BaseContext, args: string[]): Promise<void>;
    preExecution?(ctx: BaseContext): Promise<boolean>;
    execute?(ctx: ExecutionContext, args: string[]): Promise<void>;
}

export interface ContextPlugin extends Plugin {
    applyToBaseContext?(ctx: BaseContext): Promise<void>;
    applyToExecutionContext?(ctx: ExecutionContext): Promise<void>;
}

export interface ExpandRequiresResults {
    scripts?: FileRef[];
    files?: FileRef[];
}

export interface RequirePlugin extends Plugin {
    expandRequires(ctx: BaseContext, args: string[]): Promise<ExpandRequiresResults>;
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

export interface LifecyclePlugin extends Plugin {
    afterConnect?(ctx: ExecutionContext): Promise<void>;
    afterFilesSynced?(ctx: ExecutionContext): Promise<void>;
    afterExecution?(ctx: ExecutionContext): Promise<void>;
}
